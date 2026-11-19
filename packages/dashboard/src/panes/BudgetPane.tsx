import { useEffect, useState } from "react";
import { api, type VaultStatus } from "../api.js";
import { MockNotice } from "./MockNotice.js";

/** Pane 4: the vault's hard limits, today's spend, and whether the vault is paused. */
export function BudgetPane() {
  const [status, setStatus] = useState<VaultStatus | undefined>();
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await api.getStatus();
      if (!cancelled) {
        setStatus(result.data);
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
      <h2>Budget</h2>
      <MockNotice isMock={isMock} />
      {status?.paused && (
        <p className="alert">Vault paused. No payments can be sent until the owner unpauses it.</p>
      )}
      {status && (
        <dl>
          <dt>Vault balance</dt>
          <dd>{status.balanceUsdc} USDC</dd>
          <dt>Per-transaction max</dt>
          <dd>{status.perTxMaxUsdc} USDC</dd>
          <dt>Spent today</dt>
          <dd>
            {status.spentTodayUsdc} of {status.dailyBudgetUsdc} USDC
          </dd>
        </dl>
      )}
    </section>
  );
}
