import { USDC_DECIMALS } from "@provn/shared";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { api, type ChainEvent } from "../api.js";
import { EmptyState } from "./EmptyState.js";
import { Hex } from "./Hex.js";
import { MockNotice } from "./MockNotice.js";

const EXPLORER = "https://testnet.arcscan.app/tx/";

/**
 * Pane 5: every USDC transfer out of the vault, as QuickNode reports it, checked against the
 * payments Provn sent. An unmatched transfer means money left without Provn, and the vault is
 * paused.
 */
export function ChainEventsPane() {
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await api.listChainEvents();
      if (!cancelled) {
        setEvents(result.data);
        setIsMock(result.isMock);
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="pane pane-chain" aria-labelledby="chain-title">
      <div className="pane-head">
        <h2 id="chain-title">Onchain reconciliation</h2>
        <span className="count">{events.length}</span>
      </div>
      <MockNotice isMock={isMock} />
      {events.length === 0 ? (
        <EmptyState
          title="No transfers out of the vault yet"
          detail="Each one is checked against the payments Provn sent."
        />
      ) : (
        <table className="events">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Amount</th>
              <th scope="col">To</th>
              <th scope="col">Tx</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={`${event.txHash}:${event.logIndex}`}>
                <td>
                  <span className={`badge badge-${event.status}`}>{event.status}</span>
                </td>
                <td className="num">
                  {formatUnits(BigInt(event.amountBaseUnits), USDC_DECIMALS)} USDC
                </td>
                <td>
                  <Hex value={event.to} />
                </td>
                <td>
                  <a href={EXPLORER + event.txHash} target="_blank" rel="noreferrer">
                    <Hex value={event.txHash} />
                  </a>
                </td>
                <td className="detail">{event.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
