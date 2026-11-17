import type { Decision, PaymentProposal } from "@provn/shared";
import type { ApprovalService } from "../approvals/index.js";
import type { AuditLog } from "../audit/index.js";
import type { Intake } from "../intake/index.js";
import type { Ledger } from "../ledger/index.js";
import type { PolicyEngine } from "../policy/index.js";
import type { TraceFields } from "../trace/index.js";
import { newId } from "../util.js";
import { PayInputSchema } from "../validation.js";
import type { WalletAdapter } from "../wallet/index.js";

export interface PipelineDeps {
  intake: Intake;
  ledger: Ledger;
  trace: TraceFields;
  policy: PolicyEngine;
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
 * The payment path: validate, trace, decide, record, then (only if allowed) pay.
 *
 * FAIL CLOSED: any error anywhere in this path, including bad input, an unknown task, a
 * policy bug, a failed audit write, or a wallet error, returns a "deny" decision. Nothing in
 * here may let a payment through because something went wrong.
 */
export class PaymentPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async handlePay(context: PaymentContext, rawInput: unknown): Promise<Decision> {
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
        // TODO: fill requestedHost (and quantity) from the task's fetch history.
      };

      const origins = this.deps.trace(proposal, this.deps.ledger);
      const decision = this.deps.policy.evaluate(proposal, origins, task.mandate);

      // Record the decision BEFORE any money moves. If this throws, nothing is paid.
      this.deps.audit.record(proposal, decision);

      if (decision.outcome === "require_approval") {
        this.deps.approvals.create(proposal);
      } else if (decision.outcome === "allow") {
        // TODO: record the txHash in the audit log once the transfer succeeds.
        await this.deps.wallet.transfer({
          idempotencyKey: proposal.id,
          to: proposal.recipient,
          amountUsdc: proposal.amountUsdc,
        });
      }
      return decision;
    } catch (error) {
      // TODO: best-effort audit record of the failure (the audit log itself may be what failed).
      console.error("payment path failed; denying", error);
      return failClosedDecision(proposalId, error);
    }
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
