import type { Decision, LedgerEntry, PaymentProposal } from "@provn/shared";
import { describe, expect, it } from "vitest";
import { ApprovalError, InMemoryApprovalService } from "../src/approvals/index.js";
import type { AuditLog } from "../src/audit/index.js";
import { FormIntake } from "../src/intake/index.js";
import type { Ledger } from "../src/ledger/index.js";
import { PaymentPipeline, type X402Extras } from "../src/payment/pipeline.js";
import { InMemoryPaymentHistory, loadPolicy, RulesPolicyEngine } from "../src/policy/index.js";
import { serializeBoundPayment, traceFields } from "../src/trace/index.js";
import { sha256Hex } from "../src/util.js";
import { MockWalletAdapter } from "../src/wallet/index.js";

const PAYEE = "0x2222222222222222222222222222222222222222";
const T0 = new Date("2026-11-18T15:00:00Z");

const proposal = (overrides: Partial<PaymentProposal> = {}): PaymentProposal => ({
  id: "prop_1",
  taskId: "task_1",
  agentId: "agent_1",
  recipient: PAYEE,
  amountUsdc: "2",
  ...overrides,
});

const needsApproval: Decision = {
  proposalId: "prop_1",
  outcome: "require_approval",
  ruleId: "approve-new-recipient",
  reasonForUser: "This is the first payment to this recipient.",
  reasonForAgent: "Payment needs the user's approval.",
  fieldOrigins: [{ field: "recipient", value: PAYEE, origin: "trusted" }],
};

/** A clock the tests can move forward. */
function clock(start = T0) {
  let now = start.getTime();
  return { now: () => new Date(now), advance: (ms: number) => (now += ms) };
}

/** Expect `fn` to throw an ApprovalError with this code. */
function expectApprovalError(fn: () => unknown, code: ApprovalError["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApprovalError);
    expect((error as ApprovalError).code).toBe(code);
    return;
  }
  throw new Error(`expected ApprovalError ${code}`);
}

describe("InMemoryApprovalService", () => {
  it("queues a payment with a hash, an expiry, and the reason it needs approval", () => {
    const service = new InMemoryApprovalService(clock().now);
    const pending = service.create(proposal(), needsApproval);
    expect(pending.paymentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(pending.expiresAt).toBe("2026-11-18T15:15:00.000Z");
    expect(pending.reasonForUser).toBe(needsApproval.reasonForUser);
    expect(pending.fieldOrigins).toEqual(needsApproval.fieldOrigins);
    expect(service.listPending()).toEqual([pending]);
  });

  it("approves once with the right hash, then refuses to approve again", () => {
    const service = new InMemoryApprovalService(clock().now);
    const { paymentHash } = service.create(proposal(), needsApproval);

    const { approval, proposal: approved } = service.approve("prop_1", paymentHash, "jay");
    expect(approval).toEqual({
      proposalId: "prop_1",
      paymentHash,
      approvedBy: "jay",
      expiresAt: "2026-11-18T15:15:00.000Z",
    });
    expect(approved.recipient).toBe(PAYEE);
    expect(service.listPending()).toEqual([]);
    expectApprovalError(() => service.approve("prop_1", paymentHash, "jay"), "already_decided");
  });

  it("refuses a wrong hash and leaves the payment pending", () => {
    const service = new InMemoryApprovalService(clock().now);
    service.create(proposal(), needsApproval);
    expectApprovalError(() => service.approve("prop_1", "0xwrong", "jay"), "hash_mismatch");
    expect(service.listPending()).toHaveLength(1);
  });

  it("expires pending payments and refuses to approve them", () => {
    const time = clock();
    const service = new InMemoryApprovalService(time.now, 60_000);
    const { paymentHash } = service.create(proposal(), needsApproval);
    time.advance(60_000);
    expect(service.listPending()).toEqual([]);
    expectApprovalError(() => service.approve("prop_1", paymentHash, "jay"), "expired");
    expect(service.expire()).toBe(0); // already marked
  });

  it("rejects, after which the payment can't be approved", () => {
    const service = new InMemoryApprovalService(clock().now);
    const { paymentHash } = service.create(proposal(), needsApproval);
    expect(service.reject("prop_1", "jay").proposal.id).toBe("prop_1");
    expectApprovalError(() => service.approve("prop_1", paymentHash, "jay"), "already_decided");
    expectApprovalError(() => service.reject("prop_1", "jay"), "already_decided");
  });

  it("refuses unknown payments and duplicate queueing", () => {
    const service = new InMemoryApprovalService(clock().now);
    expectApprovalError(() => service.approve("nope", "0x1", "jay"), "not_found");
    expectApprovalError(() => service.reject("nope", "jay"), "not_found");
    service.create(proposal(), needsApproval);
    expectApprovalError(() => service.create(proposal(), needsApproval), "already_decided");
  });

  it("gives every request a different hash, even for identical details", () => {
    const service = new InMemoryApprovalService(clock().now);
    const a = service.create(proposal({ id: "prop_a" }), needsApproval);
    const b = service.create(proposal({ id: "prop_b" }), needsApproval);
    expect(a.paymentHash).not.toBe(b.paymentHash);
  });
});

// ---------------------------------------------------------------------------------------------
// The whole flow through the pipeline: needs approval -> user approves -> paid. In memory, no
// SQLite. The user typed the payee, so it is trusted, but it has never been paid: approval.

class FakeLedger implements Ledger {
  readonly entries: LedgerEntry[] = [];
  append(entry: LedgerEntry): void {
    this.entries.push(entry);
  }
  listByTask(taskId: string): LedgerEntry[] {
    return this.entries.filter((e) => e.taskId === taskId);
  }
}

class FakeAudit implements AuditLog {
  readonly rows: { proposalId: string; outcome: string; ruleId: string }[] = [];
  record(_proposal: PaymentProposal, decision: Decision): void {
    this.rows.push({
      proposalId: decision.proposalId,
      outcome: decision.outcome,
      ruleId: decision.ruleId,
    });
  }
  readonly executions: { proposalId: string; txHash: string }[] = [];
  recordTx(proposal: PaymentProposal, txHash: string): void {
    this.executions.push({ proposalId: proposal.id, txHash });
  }
}

async function flow(options: { wallet?: MockWalletAdapter } = {}) {
  const ledger = new FakeLedger();
  const intake = new FormIntake(ledger);
  const history = new InMemoryPaymentHistory();
  const approvals = new InMemoryApprovalService();
  const wallet = options.wallet ?? new MockWalletAdapter();
  const audit = new FakeAudit();
  const pipeline = new PaymentPipeline({
    intake,
    ledger,
    trace: traceFields,
    policy: new RulesPolicyEngine(loadPolicy(), history),
    history,
    approvals,
    wallet,
    audit,
  });
  const task = await intake.createTask(`Pay 2 USDC to ${PAYEE} for the invoice.`, {
    budgetUsdc: "10",
  });
  const context = { taskId: task.id, agentId: "agent_1" };
  const propose = async (extras: X402Extras = {}) =>
    (await pipeline.handlePay(context, { recipient: PAYEE, amount: "2" }, extras)).decision;
  return { pipeline, approvals, wallet, audit, history, propose, ledger, taskId: task.id };
}

describe("pipeline approval flow", () => {
  it("queues the payment instead of paying, then pays once the user approves", async () => {
    const { pipeline, approvals, wallet, audit, history, propose } = await flow();

    const first = await propose();
    expect([first.outcome, first.ruleId]).toEqual(["require_approval", "approve-new-recipient"]);
    expect(wallet.transfers).toHaveLength(0);

    const [pending] = approvals.listPending();
    expect(pending?.proposal.recipient).toBe(PAYEE);

    const result = await pipeline.approvePending(first.proposalId, pending!.paymentHash, "jay");
    expect(result.decision.outcome).toBe("allow");
    expect(result.decision.ruleId).toBe("user-approved");
    expect(result.txHash).toMatch(/^0xmock/);
    expect(wallet.transfers).toEqual([{ to: PAYEE, amountUsdc: "2", txHash: result.txHash }]);
    expect(history.hasPaid(PAYEE)).toBe(true);

    // The audit trail shows both steps, the approval recorded before the payment.
    expect(audit.rows.map((r) => r.ruleId)).toEqual(["approve-new-recipient", "user-approved"]);
    // And the tx hash is recorded for reconciliation.
    expect(audit.executions).toEqual([{ proposalId: first.proposalId, txHash: result.txHash }]);
  });

  it("keeps an approved x402 payment's receipt for one retry of the fetch, so it isn't paid twice", async () => {
    const { pipeline, approvals, propose, ledger, taskId } = await flow();
    // The vendor's 402, as the fetcher records it.
    const content = serializeBoundPayment({
      payee: PAYEE,
      price: "2",
      url: "https://vendor.example/r",
    });
    ledger.append({
      id: "led_402",
      source: "tool:fetch_paid_data:402",
      origin: "vendor.example",
      trust: "bound",
      contentHash: sha256Hex(content),
      content,
      createdAt: new Date().toISOString(),
      taskId,
    });
    const first = await propose({ requestedHost: "vendor.example" });
    expect(first.outcome).toBe("require_approval");
    expect(pipeline.takeX402Receipt(taskId, "vendor.example", PAYEE, "2")).toBeNull();

    const [pending] = approvals.listPending();
    const result = await pipeline.approvePending(first.proposalId, pending!.paymentHash, "jay");

    expect(pipeline.takeX402Receipt(taskId, "vendor.example", PAYEE, "2.00")).toBe(result.txHash);
    expect(pipeline.takeX402Receipt(taskId, "vendor.example", PAYEE, "2")).toBeNull();
  });

  it("can't be approved twice, so it can't pay twice", async () => {
    const { pipeline, approvals, wallet, propose } = await flow();
    const first = await propose();
    const [pending] = approvals.listPending();
    await pipeline.approvePending(first.proposalId, pending!.paymentHash, "jay");
    await expect(
      pipeline.approvePending(first.proposalId, pending!.paymentHash, "jay"),
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(wallet.transfers).toHaveLength(1);
  });

  it("re-checks the hard limits at approval time: approval never overrides a deny", async () => {
    const { pipeline, approvals, wallet, audit, history, propose } = await flow();
    const first = await propose();
    const [pending] = approvals.listPending();

    // While the request waited, other payments used up today's 20 USDC floor.
    history.record({ taskId: "other", recipient: PAYEE, amountUsdc: "19", at: new Date() });

    const result = await pipeline.approvePending(first.proposalId, pending!.paymentHash, "jay");
    expect([result.decision.outcome, result.decision.ruleId]).toEqual([
      "deny",
      "floor-daily-budget",
    ]);
    expect(result.txHash).toBeNull();
    expect(wallet.transfers).toHaveLength(0);
    expect(audit.rows.at(-1)?.ruleId).toBe("floor-daily-budget");
  });

  it("fails closed if the payment itself fails after approval", async () => {
    const wallet = new MockWalletAdapter();
    const { pipeline, approvals, propose } = await flow({ wallet });
    const first = await propose();
    const [pending] = approvals.listPending();
    await wallet.pause("test");

    const result = await pipeline.approvePending(first.proposalId, pending!.paymentHash, "jay");
    expect([result.decision.outcome, result.decision.ruleId]).toEqual(["deny", "fail_closed"]);
    expect(result.txHash).toBeNull();
    expect(wallet.transfers).toHaveLength(0);
  });

  it("records a rejection as a deny and pays nothing", async () => {
    const { pipeline, approvals, wallet, audit, propose } = await flow();
    const first = await propose();

    const result = pipeline.rejectPending(first.proposalId, "jay");
    expect([result.decision.outcome, result.decision.ruleId]).toEqual(["deny", "user-rejected"]);
    expect(result.approval).toBeNull();
    expect(approvals.listPending()).toEqual([]);
    expect(wallet.transfers).toHaveLength(0);
    expect(audit.rows.at(-1)?.ruleId).toBe("user-rejected");
  });
});
