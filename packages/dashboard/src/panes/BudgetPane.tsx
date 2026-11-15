import { USDC_DECIMALS } from "@provn/shared";
import { formatUnits } from "viem";
import { MOCK_BUDGET } from "../mock.js";

/** Pane 4: the vault's hard limits and how much of today's budget is used. */
export function BudgetPane() {
  // TODO: read these from ProvnVault with `publicClient` (see chain.ts) instead of mock values.
  // Vault amounts are USDC base units (ERC-20, 6 decimals), so format with USDC_DECIMALS.
  const { perTxMax, dailyBudget, spentToday } = MOCK_BUDGET;
  const usdc = (value: bigint) => formatUnits(value, USDC_DECIMALS);

  return (
    <section>
      <h2>Budget</h2>
      <p className="mock">Showing mock data (vault is not connected yet).</p>
      <dl>
        <dt>Per-transaction max</dt>
        <dd>{usdc(perTxMax)} USDC</dd>
        <dt>Spent today</dt>
        <dd>
          {usdc(spentToday)} of {usdc(dailyBudget)} USDC
        </dd>
      </dl>
    </section>
  );
}
