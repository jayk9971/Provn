import { db } from "../db.ts";

export interface AuditLogEntry {
  proposalId: string;
  decision: string;
  rule: string;
  reason: string;
  inputs: unknown;
  provenance: unknown;
  txHash?: string;
}

export function logAudit(entry: AuditLogEntry) {
  const stmt = db.prepare(`
    INSERT INTO audit_log (proposal_id, decision, rule, reason, inputs, provenance, tx_hash, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    entry.proposalId,
    entry.decision,
    entry.rule,
    entry.reason,
    JSON.stringify(entry.inputs),
    JSON.stringify(entry.provenance),
    entry.txHash || null
  );
}
