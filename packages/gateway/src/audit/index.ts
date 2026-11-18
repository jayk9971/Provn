import { toBaseUnits, type Decision, type PaymentProposal } from "@provn/shared";
import type Database from "better-sqlite3";

/** Append-only record of every decision, with the field origins and rule that produced it. */
export interface AuditLog {
  record(proposal: PaymentProposal, decision: Decision): void;
  /**
   * Record that an allowed payment was sent, with its tx hash. Append-only, one row per
   * proposal. QuickNode reconciliation matches onchain transfers against these rows.
   */
  recordTx(proposal: PaymentProposal, txHash: string): void;
}

export class SqliteAuditLog implements AuditLog {
  constructor(private readonly db: Database.Database) {}

  record(proposal: PaymentProposal, decision: Decision): void {
    this.db
      .prepare(
        `INSERT INTO audit_log
           (proposal_id, task_id, outcome, rule_id, reason_for_user, reason_for_agent,
            field_origins, proposal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.proposalId,
        proposal.taskId,
        decision.outcome,
        decision.ruleId,
        decision.reasonForUser,
        decision.reasonForAgent,
        JSON.stringify(decision.fieldOrigins),
        JSON.stringify(proposal),
        new Date().toISOString(),
      );
  }

  recordTx(proposal: PaymentProposal, txHash: string): void {
    this.db
      .prepare(
        `INSERT INTO payment_executions
           (proposal_id, task_id, recipient, amount_base_units, tx_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposal.id,
        proposal.taskId,
        proposal.recipient.toLowerCase(),
        toBaseUnits(proposal.amountUsdc).toString(),
        txHash.toLowerCase(),
        new Date().toISOString(),
      );
  }
}
