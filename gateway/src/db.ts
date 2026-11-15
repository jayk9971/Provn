import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || "./gateway.db";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS proposals (
    proposal_id TEXT PRIMARY KEY,
    agent_id TEXT,
    acting_for TEXT,
    session_id TEXT,
    recipient TEXT,
    amount TEXT,
    memo TEXT,
    status TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id TEXT,
    decision TEXT,
    rule TEXT,
    reason TEXT,
    inputs TEXT,
    provenance TEXT,
    tx_hash TEXT,
    timestamp TEXT
  );

  CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    proposal_id TEXT,
    payment_hash TEXT,
    recipient TEXT,
    amount TEXT,
    chain_id TEXT,
    nonce TEXT,
    status TEXT,
    expires_at TEXT,
    created_at TEXT
  );
`);
