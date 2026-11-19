import { USDC_DECIMALS } from "@provn/shared";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { api, type ChainEvent } from "../api.js";
import { MockNotice } from "./MockNotice.js";

const EXPLORER = "https://testnet.arcscan.app/tx/";
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-4)}`;

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
    <section>
      <h2>Onchain reconciliation</h2>
      <MockNotice isMock={isMock} />
      {events.length === 0 && <p>No transfers out of the vault yet.</p>}
      <table>
        <tbody>
          {events.map((event) => (
            <tr key={`${event.txHash}:${event.logIndex}`}>
              <td>
                <span className={`badge badge-${event.status}`}>{event.status}</span>
              </td>
              <td>{formatUnits(BigInt(event.amountBaseUnits), USDC_DECIMALS)} USDC</td>
              <td>to {short(event.to)}</td>
              <td>
                <a href={EXPLORER + event.txHash} target="_blank" rel="noreferrer">
                  {short(event.txHash)}
                </a>
              </td>
              <td className="reason">{event.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
