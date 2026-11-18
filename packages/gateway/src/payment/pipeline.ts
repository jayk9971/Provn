import {
  toBaseUnits,
  type ApprovalResult,
  type Decision,
  type PaymentProposal,
} from "@provn/shared";
import type { ApprovalService } from "../approvals/index.js";
import type { AuditLog } from "../audit/index.js";
import type { Intake } from "../intake/index.js";
import type { Ledger } from "../ledger/index.js";
import type { PaymentHistory, PolicyEngine } from "../policy/index.js";
import type { TraceFields } from "../trace/index.js";
import { newId } from "../util.js";
import { PayInputSchema } from "../validation.js";
import type { WalletAdapter } from "../wallet/index.js";

export interface PipelineDeps {
  intake: Intake;
  ledger: Ledger;
  trace: TraceFields;
  policy: PolicyEngine;
  history: PaymentHistory;
  approvals: ApprovalService;
  wallet: WalletAdapter;
  audit: AuditLog;
}

/** Who is asking. Comes from the authenticated MCP session, never from the agent's own input. */
export interface PaymentContext {
  taskId: string;
  agentId: string;
}

/**
 * Set by the gateway (never by the agent) when a payment answers a 402: the host the agent
 * requested, and the quantity from that request's URL. Trace uses them to bind the payee and
 * price to the 402 and to check where the quantity came from.
 */
export interface X402Extras {
  requestedHost?: string;
  quantity?: number;
}

export interface PayResult {
  decision: Decision;
  /** Set only if the payment was sent. */
  txHash: string | null;
}

/**
 * The payment path: validate, trace, decide, record, then (only if allowed) pay.
 *
 * FAIL CLOSED: any error anywhere in this path, including bad input, an unknown task, a
 * policy bug, a failed audit write, or a wallet error, returns a "deny" decision. Nothing in
 * here may let a payment through because something went wrong.
 */
export class PaymentPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  /** Paid x402 payments not yet used to fetch, by task, host, payee and amount. */
  private readonly x402Receipts = new Map<string, string>();

  async handlePay(
    context: PaymentContext,
    rawInput: unknown,
    extras: X402Extras = {},
  ): Promise<PayResult> {
    const proposalId = newId("prop");
    try {
      const input = PayInputSchema.parse(rawInput);
      const task = this.deps.intake.getTask(context.taskId);
      if (!task) throw new Error(`Unknown task: ${context.taskId}`);

      const proposal: PaymentProposal = {
        id: proposalId,
        taskId: context.taskId,
        agentId: context.agentId,
        recipient: input.recipient,
        amountUsdc: input.amount,
        memo: input.memo,
        requestedHost: extras.requestedHost,
        quantity: extras.quantity,
      };

      const origins = this.deps.trace(proposal, this.deps.ledger);
      const decision = this.deps.policy.evaluate(proposal, origins, task.mandate);

      // Record the decision BEFORE any money moves. If this throws, nothing is paid.
      this.deps.audit.record(proposal, decision);

      if (decision.outcome === "require_approval") {
        this.deps.approvals.create(proposal, decision);
      } else if (decision.outcome === "allow") {
        return { decision, txHash: await this.pay(proposal) };
      }
      return { decision, txHash: null };
    } catch (error) {
      // TODO: best-effort audit record of the failure (the audit log itself may be what failed).
      console.error("payment path failed; denying", error);
      return { decision: failClosedDecision(proposalId, error), txHash: null };
    }
  }

  /**
   * The user approved a pending payment on the dashboard. The approval is consumed first (single
   * use), then the policy is checked again: a hard limit (per-tx max, daily budget) or a deny
   * rule may apply now even though it didn't when the request was queued. A user's approval
   * satisfies "needs approval"; it never overrides a deny. Then the payment is recorded and sent.
   *
   * Throws ApprovalError for an unknown, expired, already-decided or mismatched approval (the
   * HTTP route turns these into 4xx). Any other failure returns a "deny" decision: fail closed.
   */
  async approvePending(
    proposalId: string,
    paymentHash: string,
    approvedBy: string,
  ): Promise<ApprovalResult> {
    const { approval, proposal } = this.deps.approvals.approve(proposalId, paymentHash, approvedBy);
    try {
      const task = this.deps.intake.getTask(proposal.taskId);
      if (!task) throw new Error(`Unknown task: ${proposal.taskId}`);
      const origins = this.deps.trace(proposal, this.deps.ledger);
      const recheck = this.deps.policy.evaluate(proposal, origins, task.mandate);

      if (recheck.outcome === "deny") {
        this.deps.audit.record(proposal, recheck);
        return { approval, decision: recheck, txHash: null };
      }

      const decision: Decision = {
        ...recheck,
        outcome: "allow",
        ruleId: "user-approved",
        reasonForUser: `Approved by ${approvedBy}.`,
        reasonForAgent: "Payment approved.",
      };
      // Record the approval BEFORE any money moves. If this throws, nothing is paid.
      this.deps.audit.record(proposal, decision);
      const txHash = await this.pay(proposal);
      if (proposal.requestedHost) {
        // The agent was told to wait for approval. Keep the receipt so its next fetch of the
        // same URL uses this payment instead of paying again.
        const key = receiptKey(
          proposal.taskId,
          proposal.requestedHost,
          proposal.recipient,
          proposal.amountUsdc,
        );
        this.x402Receipts.set(key, txHash);
      }
      return { approval, decision, txHash };
    } catch (error) {
      console.error("approved payment failed; denying", error);
      return { approval, decision: failClosedDecision(proposal.id, error), txHash: null };
    }
  }

  /** The user rejected a pending payment. Recorded in the audit log as a deny; nothing is paid. */
  rejectPending(proposalId: string, rejectedBy: string): ApprovalResult {
    const { proposal } = this.deps.approvals.reject(proposalId, rejectedBy);
    const decision: Decision = {
      proposalId: proposal.id,
      outcome: "deny",
      ruleId: "user-rejected",
      reasonForUser: `Rejected by ${rejectedBy}.`,
      reasonForAgent: "Payment denied.",
      fieldOrigins: [],
    };
    this.deps.audit.record(proposal, decision);
    return { approval: null, decision, txHash: null };
  }

  /**
   * The tx hash of an x402 payment that was sent (for example after the user approved it) but
   * not yet used to fetch the paid content. Single use: it is removed once taken. Lets the agent
   * retry a fetch after approval without paying a second time.
   */
  takeX402Receipt(
    taskId: string,
    requestedHost: string,
    recipient: string,
    amountUsdc: string,
  ): string | null {
    const key = receiptKey(taskId, requestedHost, recipient, amountUsdc);
    const txHash = this.x402Receipts.get(key) ?? null;
    this.x402Receipts.delete(key);
    return txHash;
  }

  /**
   * Send an allowed payment through the wallet, then record its tx hash and count it toward
   * budgets and known recipients. Throws if the wallet fails; callers turn that into a deny.
   */
  private async pay(proposal: PaymentProposal): Promise<string> {
    const { txHash } = await this.deps.wallet.transfer({
      idempotencyKey: proposal.id,
      to: proposal.recipient,
      amountUsdc: proposal.amountUsdc,
    });
    // The money has moved, so from here on nothing may turn this into a deny: a deny would
    // tell the agent to try again. Failures to record are logged loudly instead.
    try {
      this.deps.audit.recordTx(proposal, txHash);
    } catch (error) {
      console.error(`PAID BUT NOT RECORDED: ${proposal.id} ${txHash}`, error);
    }
    this.deps.history.record({
      taskId: proposal.taskId,
      recipient: proposal.recipient,
      amountUsdc: proposal.amountUsdc,
      at: new Date(),
    });
    return txHash;
  }
}

function failClosedDecision(proposalId: string, error: unknown): Decision {
  const message = error instanceof Error ? error.message : String(error);
  return {
    proposalId,
    outcome: "deny",
    ruleId: "fail_closed",
    reasonForUser: `Payment denied because of an internal error: ${message}`,
    reasonForAgent: "Payment denied.",
    fieldOrigins: [],
  };
}

function receiptKey(taskId: string, host: string, recipient: string, amountUsdc: string): string {
  return [taskId, host.toLowerCase(), recipient.toLowerCase(), toBaseUnits(amountUsdc)].join("|");
}
