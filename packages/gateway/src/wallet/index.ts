export { CircleDevWalletAdapter } from "./circle-dev.js";
export { MockWalletAdapter } from "./mock.js";
export { LocalVaultWalletAdapter } from "./local-vault.js";

/**
 * The gateway's only way to move money. Only the gateway holds wallet credentials;
 * the agent package never does.
 *
 * Amounts are whole-USDC decimal strings using the ERC-20 interface (6 decimals).
 */
export interface WalletAdapter {
  transfer(to: string, amountUsdc: string): Promise<{ txHash: string }>;
  /** Current balance in whole USDC (decimal string). */
  getBalance(): Promise<string>;
}

// TODO: add CircleAgentWalletAdapter, backed by Circle's agent wallet product, once we have
// access to it. It should implement WalletAdapter so nothing else in the gateway changes.
