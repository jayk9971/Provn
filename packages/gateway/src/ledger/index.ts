import type { LedgerEntry, TrustLabel } from "@provn/shared";
import type Database from "better-sqlite3";

/** The provenance ledger: an append-only record of every piece of content a task has seen. */
export interface Ledger {
  append(entry: LedgerEntry): void;
  /** Entries for one task, oldest first. */
  listByTask(taskId: string): LedgerEntry[];
}

interface LedgerRow {
  id: string;
  task_id: string;
  source: string;
  origin: string | null;
  trust: TrustLabel;
  content_hash: string;
  content: string;
  created_at: string;
}

export class SqliteLedger implements Ledger {
  constructor(private readonly db: Database.Database) {}

  append(entry: LedgerEntry): void {
    // TODO: verify entry.contentHash === sha256(entry.content) before inserting.
    this.db
      .prepare(
        `INSERT INTO ledger_entries
           (id, task_id, source, origin, trust, content_hash, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.taskId,
        entry.source,
        entry.origin,
        entry.trust,
        entry.contentHash,
        entry.content,
        entry.createdAt,
      );
  }

  listByTask(taskId: string): LedgerEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM ledger_entries WHERE task_id = ? ORDER BY rowid`)
      .all(taskId) as LedgerRow[];
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      origin: row.origin,
      trust: row.trust,
      contentHash: row.content_hash,
      content: row.content,
      createdAt: row.created_at,
      taskId: row.task_id,
    }));
  }
}
