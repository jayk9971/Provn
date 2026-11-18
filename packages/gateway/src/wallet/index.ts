export { CircleDevWalletAdapter } from "./circle-dev.js";
export { LocalVaultWalletAdapter } from "./local-vault.js";
export { MockWalletAdapter } from "./mock.js";

/**
 * Wallet layer: the gateway's only way to move money, and the only code that holds wallet
 * credentials. The agent package never imports this.
 *
 * Every implementation pays THROUGH the vault (or something with the same limits), never
 * straight from a wallet, so the hard floor applies even if the gateway is tricked.
 *
 * All amounts are whole-USDC decimal strings for the ERC-20 interface (6 decimals),
 * e.g. "0.05". Never native USDC (18 decimals).
 */
export interface WalletAdapter {
  /** Short name for logs and the dashboard, e.g. "circle-dev" or "mock". */
  readonly kind: string;

  /**
   * Pay `amountUsdc` to `to` through the vault. Resolves once the payment is confirmed
   * onchain. Throws on any failure (bad input, provider error, vault revert, timeout);
   * the payment pipeline turns a throw into "deny".
   *
   * Idempotent per `idempotencyKey`: calling again with the same key never pays twice.
   */
  transfer(request: TransferRequest): Promise<TransferResult>;

  /** Current vault balance and limits, for the dashboard's budget pane and pre-checks. */
  getStatus(): Promise<VaultStatus>;

  /**
   * Stop all payments from the vault. Used when reconciliation (QuickNode) finds a transfer
   * Provn did not approve. Only the vault owner can unpause, so this can only make things
   * safer. Resolves once the pause is confirmed onchain; a no-op if already paused.
   */
  pause(reason: string): Promise<PauseResult>;
}

export interface TransferRequest {
  /** Use the proposal ID. A retry with the same key returns the original result. */
  idempotencyKey: string;
  /** Recipient address, 0x + 40 hex characters. */
  to: string;
  /** Whole USDC, at most 6 decimals, greater than zero. */
  amountUsdc: string;
}

export interface TransferResult {
  /** Onchain transaction hash. Recorded in the audit trail and matched by reconciliation. */
  txHash: string;
}

export interface PauseResult {
  /** Onchain transaction hash, or null if the vault was already paused. */
  txHash: string | null;
}

/** Snapshot of the vault. Amounts are whole-USDC decimal strings. */
export interface VaultStatus {
  /** USDC held by the vault (what can actually be spent). */
  balanceUsdc: string;
  perTxMaxUsdc: string;
  dailyBudgetUsdc: string;
  /** Spent in the vault's current day; "0" if a new UTC day has started since the last spend. */
  spentTodayUsdc: string;
  /** dailyBudget minus spentToday, never below "0". */
  remainingTodayUsdc: string;
  paused: boolean;
}

// TODO: add CircleAgentWalletAdapter (Circle Agent Wallets via the Circle CLI session held on
// the gateway host) once there is a mainnet path. It implements this same interface.
