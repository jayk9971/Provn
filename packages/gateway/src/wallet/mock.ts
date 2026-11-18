import { toBaseUnits } from "@provn/shared";
import { toVaultStatus } from "./vault.js";
import type {
  PauseResult,
  TransferRequest,
  TransferResult,
  VaultStatus,
  WalletAdapter,
} from "./index.js";

export interface MockVaultLimits {
  /** Whole USDC. Defaults mirror .env.example: 5 per tx, 20 per day, 100 in the vault. */
  balanceUsdc?: string;
  perTxMaxUsdc?: string;
  dailyBudgetUsdc?: string;
  /** Recipients the mock vault may pay. Omit to allow any address. */
  allowlist?: string[];
}

/**
 * In-memory stand-in for ProvnVault, for tests and local runs. Never touches a network.
 * Enforces the same rules as the contract (paused, allowlist, per-tx max, daily budget,
 * balance), so tests see the same failures the real vault would cause.
 */
export class MockWalletAdapter implements WalletAdapter {
  readonly kind = "mock";
  /** Every payment that went through, in order. */
  readonly transfers: { to: string; amountUsdc: string; txHash: string }[] = [];
  /** Reasons passed to pause(), in order. */
  readonly pauses: string[] = [];

  private balance: bigint;
  private readonly perTxMax: bigint;
  private readonly dailyBudget: bigint;
  private readonly allowlist: Set<string> | null;
  private spentToday = 0n;
  private paused = false;
  private readonly results = new Map<string, TransferResult>();

  constructor(limits: MockVaultLimits = {}) {
    this.balance = BigInt(toBaseUnits(limits.balanceUsdc ?? "100"));
    this.perTxMax = BigInt(toBaseUnits(limits.perTxMaxUsdc ?? "5"));
    this.dailyBudget = BigInt(toBaseUnits(limits.dailyBudgetUsdc ?? "20"));
    this.allowlist = limits.allowlist
      ? new Set(limits.allowlist.map((address) => address.toLowerCase()))
      : null;
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    const previous = this.results.get(request.idempotencyKey);
    if (previous) return previous;

    const amount = BigInt(toBaseUnits(request.amountUsdc));
    if (this.paused) throw new Error("VaultPaused");
    if (this.allowlist && !this.allowlist.has(request.to.toLowerCase())) {
      throw new Error(`NotAllowlisted(${request.to})`);
    }
    if (amount > this.perTxMax) throw new Error("ExceedsPerTxMax");
    if (this.spentToday + amount > this.dailyBudget) throw new Error("ExceedsDailyBudget");
    if (amount > this.balance) throw new Error("TransferFailed: insufficient balance");

    this.balance -= amount;
    this.spentToday += amount;
    const txHash = `0xmock${(this.transfers.length + 1).toString(16).padStart(60, "0")}`;
    const result = { txHash };
    this.transfers.push({ to: request.to, amountUsdc: request.amountUsdc, txHash });
    this.results.set(request.idempotencyKey, result);
    return result;
  }

  async getStatus(): Promise<VaultStatus> {
    const now = BigInt(Math.floor(Date.now() / 1000));
    return toVaultStatus(
      {
        balance: this.balance,
        perTxMax: this.perTxMax,
        dailyBudget: this.dailyBudget,
        spentToday: this.spentToday,
        dayStart: now, // the mock never rolls over to a new day
        paused: this.paused,
      },
      now,
    );
  }

  async pause(reason: string): Promise<PauseResult> {
    this.pauses.push(reason);
    if (this.paused) return { txHash: null };
    this.paused = true;
    return { txHash: `0xmockpause${this.pauses.length.toString(16).padStart(55, "0")}` };
  }
}