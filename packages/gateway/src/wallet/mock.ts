import type { WalletAdapter } from "./index.js";

/** In-memory wallet for tests. Records transfers and never touches a network. */
export class MockWalletAdapter implements WalletAdapter {
  readonly transfers: { to: string; amountUsdc: string }[] = [];

  constructor(private balanceUsdc = "100") {}

  async transfer(to: string, amountUsdc: string): Promise<{ txHash: string }> {
    // TODO: subtract amountUsdc from the balance and reject if it would go negative.
    this.transfers.push({ to, amountUsdc });
    return { txHash: `0xmock${this.transfers.length.toString(16).padStart(60, "0")}` };
  }

  async getBalance(): Promise<string> {
    return this.balanceUsdc;
  }
}
