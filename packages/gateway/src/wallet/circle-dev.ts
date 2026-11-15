import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { NotImplementedError } from "../errors.js";
import type { WalletAdapter } from "./index.js";

export interface CircleDevWalletCredentials {
  apiKey: string;
  entitySecret: string;
  walletId: string;
}

/** Wallet backed by a Circle developer-controlled wallet. Credentials come from env. */
export class CircleDevWalletAdapter implements WalletAdapter {
  private readonly client: ReturnType<typeof initiateDeveloperControlledWalletsClient>;

  constructor(private readonly credentials: CircleDevWalletCredentials) {
    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: credentials.apiKey,
      entitySecret: credentials.entitySecret,
    });
  }

  /** Build from CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID. Throws if any is unset. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): CircleDevWalletAdapter {
    const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID } = env;
    if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET || !CIRCLE_WALLET_ID) {
      throw new Error("CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and CIRCLE_WALLET_ID must be set");
    }
    return new CircleDevWalletAdapter({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
      walletId: CIRCLE_WALLET_ID,
    });
  }

  async transfer(_to: string, _amountUsdc: string): Promise<{ txHash: string }> {
    // TODO: send `amountUsdc` of the USDC ERC-20 (6 decimals, ARC_USDC_ADDRESS) to `_to` using
    // this.client.createTransaction({ walletId: this.credentials.walletId, ... }), then poll
    // until the transaction has a txHash.
    // Open question: a direct ERC-20 transfer skips the vault's limits. To keep them enforced,
    // call ProvnVault.spend(to, amount) with createContractExecutionTransaction instead.
    void this.client;
    throw new NotImplementedError("CircleDevWalletAdapter.transfer");
  }

  async getBalance(): Promise<string> {
    // TODO: read the wallet's USDC balance with this.client.getWalletTokenBalance(...) and
    // return it as a whole-USDC decimal string.
    throw new NotImplementedError("CircleDevWalletAdapter.getBalance");
  }
}
