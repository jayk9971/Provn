import type Database from "better-sqlite3";
import { InMemoryApprovalService, type ApprovalService } from "./approvals/index.js";
import { SqliteAuditLog, type AuditLog } from "./audit/index.js";
import type { GatewayConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { Reconciler, SqliteChainEventStore } from "./reconcile/index.js";
import { HttpFetcher, type Fetcher } from "./fetcher/index.js";
import { FormIntake, type Intake } from "./intake/index.js";
import { SqliteLedger, type Ledger } from "./ledger/index.js";
import { PaymentPipeline } from "./payment/pipeline.js";
import {
  InMemoryPaymentHistory,
  loadPolicy,
  RulesPolicyEngine,
  type PaymentHistory,
  type PolicyEngine,
} from "./policy/index.js";
import { traceFields } from "./trace/index.js";
import {
  CircleDevWalletAdapter,
  LocalVaultWalletAdapter,
  MockWalletAdapter,
  type WalletAdapter,
} from "./wallet/index.js";

export interface Services {
  db: Database.Database;
  ledger: Ledger;
  intake: Intake;
  fetcher: Fetcher;
  policy: PolicyEngine;
  history: PaymentHistory;
  approvals: ApprovalService;
  wallet: WalletAdapter;
  audit: AuditLog;
  pipeline: PaymentPipeline;
  chainEvents: SqliteChainEventStore;
  reconciler: Reconciler;
}

/** Test seams: swap the network and the wallet for fakes. */
export interface ServiceOverrides {
  /** Used by the fetcher instead of the global fetch, e.g. a fake vendor. */
  fetchImpl?: typeof fetch;
  wallet?: WalletAdapter;
}

/** Build every service from config. This is the one place where implementations are chosen. */
export function createServices(config: GatewayConfig, overrides: ServiceOverrides = {}): Services {
  const db = openDatabase(config.dbPath);
  const ledger = new SqliteLedger(db);
  const intake = new FormIntake(ledger);
  const fetcher: Fetcher = new HttpFetcher(ledger, overrides.fetchImpl);
  const history = new InMemoryPaymentHistory();
  const policy = new RulesPolicyEngine(loadPolicy(config.policyPath), history);
  const approvals = new InMemoryApprovalService();
  const wallet = overrides.wallet ?? createWallet(config);
  const audit = new SqliteAuditLog(db);
  const pipeline = new PaymentPipeline({
    intake,
    ledger,
    trace: traceFields,
    policy,
    history,
    approvals,
    wallet,
    audit,
  });
  const chainEvents = new SqliteChainEventStore(db);
  const reconciler = new Reconciler({
    findExecution: (txHash) => audit.findExecution(txHash),
    events: chainEvents,
    wallet,
    graceMs: config.reconcileGraceMs,
  });
  return {
    db,
    ledger,
    intake,
    fetcher,
    policy,
    history,
    approvals,
    wallet,
    audit,
    pipeline,
    chainEvents,
    reconciler,
  };
}

function createWallet(config: GatewayConfig): WalletAdapter {
  switch (config.walletAdapter) {
    case "circle-dev":
      return CircleDevWalletAdapter.fromEnv();
    case "local-vault":
      return LocalVaultWalletAdapter.fromEnv();
    case "mock":
      return new MockWalletAdapter();
  }
}
