import type Database from "better-sqlite3";

/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many have run.
 * To change the schema, append a new entry. Never edit an existing one.
 *
 * Both the ledger and the audit log are append-only: triggers abort any UPDATE or DELETE.
 * All gateway tables live in this one list so the migration order is explicit.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE ledger_entries (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL,
    source       TEXT NOT NULL,
    origin       TEXT,
    trust        TEXT NOT NULL CHECK (trust IN ('trusted', 'bound', 'untrusted', 'derived')),
    content_hash TEXT NOT NULL,
    content      TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX ledger_entries_task_idx ON ledger_entries (task_id, created_at);
  CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

  CREATE TABLE audit_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id      TEXT NOT NULL,
    task_id          TEXT NOT NULL,
    outcome          TEXT NOT NULL,
    rule_id          TEXT NOT NULL,
    reason_for_user  TEXT NOT NULL,
    reason_for_agent TEXT NOT NULL,
    field_origins    TEXT NOT NULL,
    proposal         TEXT NOT NULL,
    created_at       TEXT NOT NULL
  );
  CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  `,
  // 2: payments that were actually sent, with their tx hash. Append-only, like audit_log.
  `
  CREATE TABLE payment_executions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id       TEXT NOT NULL UNIQUE,
    task_id           TEXT NOT NULL,
    recipient         TEXT NOT NULL,
    amount_base_units TEXT NOT NULL,
    tx_hash           TEXT NOT NULL,
    created_at        TEXT NOT NULL
  );
  CREATE INDEX payment_executions_tx_hash ON payment_executions (tx_hash);
  CREATE TRIGGER payment_executions_no_update BEFORE UPDATE ON payment_executions
    BEGIN SELECT RAISE(ABORT, 'payment executions are append-only'); END;
  CREATE TRIGGER payment_executions_no_delete BEFORE DELETE ON payment_executions
    BEGIN SELECT RAISE(ABORT, 'payment executions are append-only'); END;
  `,
];

/** Bring the database up to the latest schema. Safe to call on every startup. */
export function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version] as string;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
