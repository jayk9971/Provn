import { fromBaseUnits } from "@provn/shared";
import { parseAbi } from "viem";
import type { VaultStatus } from "./index.js";

/** The parts of ProvnVault and the USDC ERC-20 the gateway reads. */
export const VAULT_ABI = parseAbi([
  "function perTxMax() view returns (uint256)",
  "function dailyBudget() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function dayStart() view returns (uint256)",
  "function paused() view returns (bool)",
]);

export const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** Raw vault values, in USDC base units (6 decimals). */
export interface RawVaultState {
  balance: bigint;
  perTxMax: bigint;
  dailyBudget: bigint;
  spentToday: bigint;
  dayStart: bigint;
  paused: boolean;
}

const SECONDS_PER_DAY = 86_400n;

/**
 * Turn raw vault values into a VaultStatus. Mirrors the contract: if a new UTC day has
 * started since `dayStart`, the next spend resets `spentToday`, so it counts as 0 now.
 */
export function toVaultStatus(raw: RawVaultState, nowSeconds: bigint): VaultStatus {
  const today = (nowSeconds / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  const spentToday = today > raw.dayStart ? 0n : raw.spentToday;
  const remaining = raw.dailyBudget > spentToday ? raw.dailyBudget - spentToday : 0n;
  return {
    balanceUsdc: fromBaseUnits(raw.balance),
    perTxMaxUsdc: fromBaseUnits(raw.perTxMax),
    dailyBudgetUsdc: fromBaseUnits(raw.dailyBudget),
    spentTodayUsdc: fromBaseUnits(spentToday),
    remainingTodayUsdc: fromBaseUnits(remaining),
    paused: raw.paused,
  };
}