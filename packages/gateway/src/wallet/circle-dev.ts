import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { toBaseUnits } from "@provn/shared";
import { NotImplementedError } from "../errors.js";
import type { WalletAdapter } from "./index.js";

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

export interface CircleDevWalletCredentials {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  vaultAddress: string;
}


/** The only vault function Provn's key may call. */
const VAULT_SPEND_SIGNATURE = "spend(address,uint256)";

/** How long to wait for Circle to confirm a payment before giving up (and denying). */
const CONFIRM_TIMEOUT_MS = 90_000;

const ADDRESS_FORMAT = /^0x[0-9a-fA-F]{40}$/;



/** Wallet backed by a Circle developer-controlled wallet. Credentials come from env. */
export class CircleDevWalletAdapter implements WalletAdapter {
  private readonly client: CircleClient;

  /** `client` is injectable so tests can use a fake; production builds the real one. */
  constructor(
    private readonly credentials: CircleDevWalletCredentials,
    client?: CircleClient,
  ) {
    this.client =
      client ??
      initiateDeveloperControlledWalletsClient({
        apiKey: credentials.apiKey,
        entitySecret: credentials.entitySecret,
      });
  }

  /** Build from CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID. Throws if any is unset. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): CircleDevWalletAdapter {
    const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID, VAULT_ADDRESS } = env;
    if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET || !CIRCLE_WALLET_ID || !VAULT_ADDRESS) {
      throw new Error(
        "CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID and VAULT_ADDRESS must be set",
      );
    }
    if (!ADDRESS_FORMAT.test(VAULT_ADDRESS)) {
      throw new Error(`VAULT_ADDRESS is not an address: "${VAULT_ADDRESS}"`);
    }
    return new CircleDevWalletAdapter({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
      walletId: CIRCLE_WALLET_ID,
      vaultAddress: VAULT_ADDRESS,
    });
  }

  async transfer(_to: string, _amountUsdc: string): Promise<{ txHash: string }> {
    if (!ADDRESS_FORMAT.test(_to)) throw new Error(`Recipient is not an address: "${_to}"`);
    
    const amount = toBaseUnits(_amountUsdc);
    
    const created = await this.client.createContractExecutionTransaction({
      walletId: this.credentials.walletId,
      contractAddress: this.credentials.vaultAddress,
      abiFunctionSignature: VAULT_SPEND_SIGNATURE,
      abiParameters: [_to, amount],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const transactionId = created.data?.id;
    if (!transactionId) throw new Error("Circle did not return a transaction ID");

    return { txHash: await this.waitForTxHash(transactionId) };
  }

  /**
 * Wait until Circle reports the transaction CONFIRMED (or COMPLETE), then return its hash.
 * The SDK rejects on its own if the transaction fails, is cancelled, denied, or stuck,
 * which covers a vault revert (over the limit, not allowlisted, paused).
 */
  private async waitForTxHash(transactionId: string): Promise<string> {
    const response = await this.client.getTransaction({
      id: transactionId,
      waitForState: "CONFIRMED",
      pollingInterval: 1500,
      signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
    });
    const txHash = response.data?.transaction?.txHash;
    if (!txHash) throw new Error(`Transaction ${transactionId} confirmed without a tx hash`);
    return txHash;
  }


  async getBalance(): Promise<string> {
    // TODO: return the VAULT's USDC balance (that is where the money is), read with
    // usdc.balanceOf(vaultAddress) on Arc. Needs an RPC client such as viem in the gateway;
    // ask before adding it. The Circle wallet itself only holds gas money.    // return it as a whole-USDC decimal string.
    throw new NotImplementedError("CircleDevWalletAdapter.getBalance");
  }





}
