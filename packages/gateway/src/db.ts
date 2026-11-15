import Database from "better-sqlite3";
import { migrate } from "./ledger/migrations.js";

/** Open the gateway database and bring its schema up to date. Use ":memory:" in tests. */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}
