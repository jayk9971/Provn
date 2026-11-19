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

/** A payment Provn sent, as recorded in payment_executions. Addresses are lowercase. */
export interface PaymentExecution {
  proposalId: string;
  recipient: string;
  amountBaseUnits: string;
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

  /** The sent payment with this tx hash, if Provn made it. Used by QuickNode reconciliation. */
  findExecution(txHash: string): PaymentExecution | null {
    const row = this.db
      .prepare(
        `SELECT proposal_id, recipient, amount_base_units FROM payment_executions
         WHERE tx_hash = ?`,
      )
      .get(txHash.toLowerCase()) as
      { proposal_id: string; recipient: string; amount_base_units: string } | undefined;
    return row
      ? {
          proposalId: row.proposal_id,
          recipient: row.recipient,
          amountBaseUnits: row.amount_base_units,
        }
      : null;
  }
}
