import { createHash } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { ARC_TESTNET_RPC_URL, ARC_USDC_ADDRESS, toBaseUnits } from "@provn/shared";
import { createPublicClient, http, type Address } from "viem";
import type {
  PauseResult,
  TransferRequest,
  TransferResult,
  VaultStatus,
  WalletAdapter,
} from "./index.js";
import { ERC20_ABI, VAULT_ABI, toVaultStatus } from "./vault.js";

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

/** The vault reads this adapter needs. Injectable so tests can fake the chain. */
export interface VaultReader {
  readContract(args: {
    address: Address;
    abi: typeof VAULT_ABI | typeof ERC20_ABI;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export interface CircleDevWalletCredentials {
  apiKey: string;
  entitySecret: string;
  /** Circle wallet ID. This wallet is the vault's `spender`; it holds only gas money. */
  walletId: string;
  /** ProvnVault address on Arc. The vault holds the USDC and enforces the hard limits. */
  vaultAddress: string;
  /** USDC ERC-20 address (6 decimals). Defaults to Arc testnet's. */
  usdcAddress?: string;
  /** Arc RPC URL for reads. Defaults to Arc testnet's public RPC. */
  rpcUrl?: string;
}

/** How long to wait for Circle to confirm a transaction before giving up. */
const CONFIRM_TIMEOUT_MS = 90_000;

const ADDRESS_FORMAT = /^0x[0-9a-fA-F]{40}$/;

/**
 * Pays through ProvnVault using a Circle developer-controlled wallet.
 *
 * Money never moves straight from the Circle wallet to the payee. Every payment is a call to
 * `ProvnVault.spend(to, amount)`, so the vault's per-tx max, daily budget, allowlist, and pause
 * apply even if the gateway is tricked or compromised. Reads (balance, limits) go straight to
 * the chain with viem; writes go through Circle.
 */
export class CircleDevWalletAdapter implements WalletAdapter {
  readonly kind = "circle-dev";
  private readonly client: CircleClient;
  private readonly reader: VaultReader;
  private readonly vault: Address;
  private readonly usdc: Address;

  /** `client` and `reader` are injectable so tests can use fakes. */
  constructor(
    private readonly credentials: CircleDevWalletCredentials,
    deps: { client?: CircleClient; reader?: VaultReader } = {},
  ) {
    if (!ADDRESS_FORMAT.test(credentials.vaultAddress)) {
      throw new Error(`Vault address is not an address: "${credentials.vaultAddress}"`);
    }
    this.vault = credentials.vaultAddress as Address;
    this.usdc = (credentials.usdcAddress ?? ARC_USDC_ADDRESS) as Address;
    this.client =
      deps.client ??
      initiateDeveloperControlledWalletsClient({
        apiKey: credentials.apiKey,
        entitySecret: credentials.entitySecret,
      });
    this.reader =
      deps.reader ??
      (createPublicClient({
        transport: http(credentials.rpcUrl ?? ARC_TESTNET_RPC_URL),
      }) as unknown as VaultReader);
  }

  /**
   * Build from CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID, VAULT_ADDRESS, and
   * optionally USDC_ADDRESS and ARC_RPC_URL. Throws if a required one is unset.
   */
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
      usdcAddress: env.USDC_ADDRESS || undefined,
      rpcUrl: env.ARC_RPC_URL || undefined,
    });
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    if (!ADDRESS_FORMAT.test(request.to)) {
      throw new Error(`Recipient is not an address: "${request.to}"`);
    }
    const amount = toBaseUnits(request.amountUsdc); // ERC-20 base units, 6 decimals
    const txHash = await this.executeOnVault(
      "spend(address,uint256)",
      [request.to, amount],
      `spend:${request.idempotencyKey}`,
    );
    return { txHash };
  }

  async getStatus(): Promise<VaultStatus> {
    const read = (functionName: string) =>
      this.reader.readContract({ address: this.vault, abi: VAULT_ABI, functionName });
    const [balance, perTxMax, dailyBudget, spentToday, dayStart, paused] = await Promise.all([
      this.reader.readContract({
        address: this.usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.vault],
      }),
      read("perTxMax"),
      read("dailyBudget"),
      read("spentToday"),
      read("dayStart"),
      read("paused"),
    ]);
    return toVaultStatus(
      {
        balance: balance as bigint,
        perTxMax: perTxMax as bigint,
        dailyBudget: dailyBudget as bigint,
        spentToday: spentToday as bigint,
        dayStart: dayStart as bigint,
        paused: paused as boolean,
      },
      BigInt(Math.floor(Date.now() / 1000)),
    );
  }

  async pause(reason: string): Promise<PauseResult> {
    const paused = await this.reader.readContract({
      address: this.vault,
      abi: VAULT_ABI,
      functionName: "paused",
    });
    if (paused === true) return { txHash: null };
    // Requires ProvnVault.pause() to allow the spender (see the contract change). The reason
    // is not stored onchain; the caller records it in the audit trail.
    void reason;
    const txHash = await this.executeOnVault("pause()", [], `pause:${Date.now()}`);
    return { txHash };
  }

  /**
   * Call a ProvnVault function from the Circle wallet and wait until it is confirmed.
   * The SDK rejects on its own if the transaction fails, is cancelled, denied, or stuck,
   * which covers a vault revert (over the limit, not allowlisted, paused).
   */
  private async executeOnVault(
    abiFunctionSignature: string,
    abiParameters: string[],
    idempotencyKey: string,
  ): Promise<string> {
    const created = await this.client.createContractExecutionTransaction({
      walletId: this.credentials.walletId,
      contractAddress: this.credentials.vaultAddress,
      abiFunctionSignature,
      abiParameters,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: toUuid(idempotencyKey),
    });
    const transactionId = created.data?.id;
    if (!transactionId) throw new Error("Circle did not return a transaction ID");

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
}

/**
 * Circle expects UUID idempotency keys. Derive one deterministically from our key, so the
 * same proposal always maps to the same UUID and Circle deduplicates retries.
 */
export function toUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; // version 4 layout
  hex[16] = ((parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16); // RFC 4122 variant
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}