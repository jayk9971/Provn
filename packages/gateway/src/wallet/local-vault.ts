import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ADDRESS,
  toBaseUnits,
} from "@provn/shared";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type {
  PauseResult,
  TransferRequest,
  TransferResult,
  VaultStatus,
  WalletAdapter,
} from "./index.js";
import { ERC20_ABI, VAULT_ABI, toVaultStatus } from "./vault.js";

const VAULT_WRITE_ABI = parseAbi([
  "function spend(address to, uint256 amount)",
  "function pause()",
]);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

export interface LocalVaultCredentials {
  /** Testnet private key of the vault's spender. Gateway only; never give it to the agent. */
  privateKey: Hex;
  vaultAddress: Address;
  usdcAddress?: Address;
  rpcUrl?: string;
  chainId?: number;
}

/**
 * Pays through ProvnVault.spend, signing with a local testnet spender key via viem.
 *
 * A fallback for when the Circle developer wallet isn't set up: the vault enforces the same
 * limits either way. Idempotency is in memory only (Circle's adapter gets it from Circle), so a
 * gateway restart forgets which proposals were already paid.
 */
export class LocalVaultWalletAdapter implements WalletAdapter {
  readonly kind = "local-vault";
  private readonly account: PrivateKeyAccount;
  private readonly wallet: WalletClient;
  private readonly reader: PublicClient;
  private readonly vault: Address;
  private readonly usdc: Address;
  private readonly paid = new Map<string, string>();

  constructor(credentials: LocalVaultCredentials) {
    const rpcUrl = credentials.rpcUrl ?? ARC_TESTNET_RPC_URL;
    const chain = defineChain({
      id: credentials.chainId ?? ARC_TESTNET_CHAIN_ID,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    this.account = privateKeyToAccount(credentials.privateKey);
    this.wallet = createWalletClient({ account: this.account, chain, transport: http(rpcUrl) });
    this.reader = createPublicClient({ chain, transport: http(rpcUrl) });
    this.vault = credentials.vaultAddress;
    this.usdc = credentials.usdcAddress ?? (ARC_USDC_ADDRESS as Address);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): LocalVaultWalletAdapter {
    const privateKey = env.SPENDER_PRIVATE_KEY;
    const vaultAddress = env.VAULT_ADDRESS;
    if (!privateKey || !PRIVATE_KEY.test(privateKey)) {
      throw new Error("SPENDER_PRIVATE_KEY must be set to a 0x-prefixed 32-byte hex key");
    }
    if (!vaultAddress || !ADDRESS.test(vaultAddress)) {
      throw new Error("VAULT_ADDRESS must be set to the deployed ProvnVault address");
    }
    if (env.USDC_ADDRESS && !ADDRESS.test(env.USDC_ADDRESS)) {
      throw new Error("USDC_ADDRESS must be a 0x address");
    }
    return new LocalVaultWalletAdapter({
      privateKey: privateKey as Hex,
      vaultAddress: vaultAddress as Address,
      usdcAddress: (env.USDC_ADDRESS || undefined) as Address | undefined,
      rpcUrl: env.ARC_RPC_URL || undefined,
      chainId: env.ARC_CHAIN_ID ? Number(env.ARC_CHAIN_ID) : undefined,
    });
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    const already = this.paid.get(request.idempotencyKey);
    if (already) return { txHash: already };
    if (!ADDRESS.test(request.to)) throw new Error(`Invalid recipient: ${request.to}`);

    const amount = BigInt(toBaseUnits(request.amountUsdc));
    const { request: tx } = await this.reader.simulateContract({
      account: this.account,
      address: this.vault,
      abi: VAULT_WRITE_ABI,
      functionName: "spend",
      args: [request.to as Address, amount],
    });
    const txHash = await this.send(await this.wallet.writeContract(tx));
    this.paid.set(request.idempotencyKey, txHash);
    return { txHash };
  }

  async getStatus(): Promise<VaultStatus> {
    const read = (functionName: "perTxMax" | "dailyBudget" | "spentToday" | "dayStart") =>
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
      this.reader.readContract({ address: this.vault, abi: VAULT_ABI, functionName: "paused" }),
    ]);
    return toVaultStatus(
      { balance, perTxMax, dailyBudget, spentToday, dayStart, paused },
      BigInt(Math.floor(Date.now() / 1000)),
    );
  }

  async pause(_reason: string): Promise<PauseResult> {
    const paused = await this.reader.readContract({
      address: this.vault,
      abi: VAULT_ABI,
      functionName: "paused",
    });
    if (paused) return { txHash: null };
    const { request: tx } = await this.reader.simulateContract({
      account: this.account,
      address: this.vault,
      abi: VAULT_WRITE_ABI,
      functionName: "pause",
    });
    return { txHash: await this.send(await this.wallet.writeContract(tx)) };
  }

  /**
   * Callers simulate first, so a revert (over the limit, not allowlisted, paused) throws before
   * any gas is spent. This waits for the receipt; a failed receipt throws too.
   */
  private async send(hash: Hex): Promise<string> {
    const receipt = await this.reader.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Vault transaction reverted: ${hash}`);
    return hash;
  }
}
