import { toBaseUnits } from "@provn/shared";

/** One payment that actually went through (the wallet confirmed it). */
export interface PaymentRecord {
  taskId: string;
  recipient: string;
  amountUsdc: string;
  at: Date;
}

/**
 * What the policy engine needs to know about past payments: how much a task has spent, how much
 * went out today, and whether a recipient has been paid before.
 *
 * Only payments that actually went through count. Denied or pending proposals do not.
 */
export interface PaymentHistory {
  /** Record a payment the wallet confirmed. Called by the payment pipeline after transfer(). */
  record(payment: PaymentRecord): void;
  /** Total paid for this task, in USDC base units (6 decimals). */
  spentByTask(taskId: string): bigint;
  /** Total paid during the UTC day containing `now`, in base units. Matches the vault's day. */
  spentOnDay(now: Date): bigint;
  /** Has this address ever been paid? Case-insensitive. */
  hasPaid(recipient: string): boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * In-memory history. Resets when the gateway restarts, which is fine for the demo.
 * TODO: back this with the payment_executions table (the same one QuickNode reconciliation
 * reads), so spend and known recipients survive a restart.
 */
export class InMemoryPaymentHistory implements PaymentHistory {
  private readonly payments: { taskId: string; recipient: string; amount: bigint; at: Date }[] =
    [];
  private readonly known: Set<string>;

  /**
   * @param knownRecipients addresses to treat as already paid, e.g. a demo vendor the owner has
   *   vetted. Use sparingly: a known recipient skips the "first payment" approval.
   */
  constructor(knownRecipients: string[] = []) {
    this.known = new Set(knownRecipients.map((address) => address.toLowerCase()));
  }

  record(payment: PaymentRecord): void {
    this.payments.push({
      taskId: payment.taskId,
      recipient: payment.recipient.toLowerCase(),
      amount: BigInt(toBaseUnits(payment.amountUsdc)),
      at: payment.at,
    });
    this.known.add(payment.recipient.toLowerCase());
  }

  spentByTask(taskId: string): bigint {
    return this.sum((p) => p.taskId === taskId);
  }

  spentOnDay(now: Date): bigint {
    const dayStart = Math.floor(now.getTime() / MS_PER_DAY) * MS_PER_DAY;
    return this.sum((p) => p.at.getTime() >= dayStart && p.at.getTime() < dayStart + MS_PER_DAY);
  }

  hasPaid(recipient: string): boolean {
    return this.known.has(recipient.toLowerCase());
  }

  private sum(match: (p: { taskId: string; at: Date }) => boolean): bigint {
    return this.payments.filter(match).reduce((total, p) => total + p.amount, 0n);
  }
}