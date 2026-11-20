import { useEffect, useState } from "react";
import { api, type VaultStatus } from "../api.js";
import { EmptyState } from "./EmptyState.js";
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
    <section
      className={status?.paused ? "pane pane-budget pane-alert" : "pane pane-budget"}
      aria-labelledby="budget-title"
    >
      <div className="pane-head">
        <h2 id="budget-title">Vault budget</h2>
      </div>
      <MockNotice isMock={isMock} />
      {status?.paused && (
        <p className="alert" role="alert">
          Vault paused. No payments can be sent until the owner unpauses it.
        </p>
      )}
      {!status && (
        <EmptyState title="Loading vault status" detail="Limits appear once the vault is read." />
      )}
      {status && (
        <div className="budget">
          <SpendMeter spent={status.spentTodayUsdc} budget={status.dailyBudgetUsdc} />
          <dl className="facts">
            <dt>Remaining today</dt>
            <dd>{status.remainingTodayUsdc} USDC</dd>
            <dt>Per-transaction max</dt>
            <dd>{status.perTxMaxUsdc} USDC</dd>
            <dt>Vault balance</dt>
            <dd>{status.balanceUsdc} USDC</dd>
          </dl>
        </div>
      )}
    </section>
  );
}

/** Spent vs daily budget as a bar. The numbers are display-only; the vault enforces limits. */
function SpendMeter({ spent, budget }: { spent: string; budget: string }) {
  const spentNum = Number(spent);
  const budgetNum = Number(budget);
  const ratio = budgetNum > 0 && Number.isFinite(spentNum) ? spentNum / budgetNum : 0;
  const percent = Math.min(100, Math.max(0, ratio * 100));
  const fill =
    percent >= 100
      ? "meter-fill meter-fill-full"
      : percent >= 80
        ? "meter-fill meter-fill-high"
        : "meter-fill";

  return (
    <div>
      <div className="meter-head">
        <span className="meter-value">
          {spent} <span className="muted">of {budget} USDC</span>
        </span>
        <span className="muted">Spent today</span>
      </div>
      <div
        className="meter"
        role="progressbar"
        aria-label="Spent today"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={`${spent} of ${budget} USDC`}
      >
        <div className={fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
