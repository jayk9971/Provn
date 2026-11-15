import type Database from "better-sqlite3";
import { StubApprovalService, type ApprovalService } from "./approvals/index.js";
import { SqliteAuditLog, type AuditLog } from "./audit/index.js";
import type { GatewayConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { StubFetcher, type Fetcher } from "./fetcher/index.js";
import { StubIntake, type Intake } from "./intake/index.js";
import { SqliteLedger, type Ledger } from "./ledger/index.js";
import { PaymentPipeline } from "./payment/pipeline.js";
import { loadPolicy, StubPolicyEngine, type PolicyEngine } from "./policy/index.js";
import { traceFields } from "./trace/index.js";
import { CircleDevWalletAdapter, MockWalletAdapter, type WalletAdapter } from "./wallet/index.js";

export interface Services {
  db: Database.Database;
  ledger: Ledger;
  intake: Intake;
  fetcher: Fetcher;
  policy: PolicyEngine;
  approvals: ApprovalService;
  wallet: WalletAdapter;
  audit: AuditLog;
  pipeline: PaymentPipeline;
}

/** Build every service from config. This is the one place where implementations are chosen. */
export function createServices(config: GatewayConfig): Services {
  const db = openDatabase(config.dbPath);
  const ledger = new SqliteLedger(db);
  const intake = new StubIntake(ledger);
  const fetcher = new StubFetcher(ledger);
  const policy = new StubPolicyEngine(loadPolicy(config.policyPath));
  const approvals = new StubApprovalService();
  const wallet =
    config.walletAdapter === "circle-dev"
      ? CircleDevWalletAdapter.fromEnv()
      : new MockWalletAdapter();
  const audit = new SqliteAuditLog(db);
  const pipeline = new PaymentPipeline({
    intake,
    ledger,
    trace: traceFields,
    policy,
    approvals,
    wallet,
    audit,
  });
  return { db, ledger, intake, fetcher, policy, approvals, wallet, audit, pipeline };
}
