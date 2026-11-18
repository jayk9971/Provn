import type { Decision, PaymentProposal } from "@provn/shared";
import type Database from "better-sqlite3";

/** Append-only record of every decision, with the field origins and rule that produced it. */
export interface AuditLog {
  record(proposal: PaymentProposal, decision: Decision): void;
  recordTx(proposalId: string, txHash: string): void;
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

  recordTx(proposalId: string, txHash: string): void {
    this.db
      .prepare(`UPDATE audit_log SET tx_hash = ? WHERE proposal_id = ?`)
      .run(txHash, proposalId);
  }
}
