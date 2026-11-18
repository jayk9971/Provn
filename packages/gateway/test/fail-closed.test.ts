import { beforeEach, describe, expect, it } from "vitest";
import { StubApprovalService } from "../src/approvals/index.js";
import { SqliteAuditLog } from "../src/audit/index.js";
import { openDatabase } from "../src/db.js";
import { StubIntake } from "../src/intake/index.js";
import { SqliteLedger } from "../src/ledger/index.js";
import { PaymentPipeline, type PipelineDeps } from "../src/payment/pipeline.js";
import { loadPolicy, StubPolicyEngine } from "../src/policy/index.js";
import { traceFields } from "../src/trace/index.js";
import { MockWalletAdapter } from "../src/wallet/index.js";

const VALID_PAY = { recipient: "0x" + "ab".repeat(20), amount: "1.00", memo: "test" };

/**
 * Fail closed: any error in the payment path must return "deny", and must never move money.
 */
describe("payment path fails closed", () => {
  let deps: PipelineDeps;
  let wallet: MockWalletAdapter;
  let taskId: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    const ledger = new SqliteLedger(db);
    const intake = new StubIntake(ledger);
    wallet = new MockWalletAdapter();
    deps = {
      intake,
      ledger,
      trace: traceFields,
      policy: new StubPolicyEngine(loadPolicy()),
      approvals: new StubApprovalService(),
      wallet,
      audit: new SqliteAuditLog(db),
    };
    taskId = (await intake.createTask("Buy one market report")).id;
  });

  const run = (input: unknown, id = taskId) =>
    new PaymentPipeline(deps).handlePay({ taskId: id, agentId: "agent-1" }, input);

  it("denies invalid input", async () => {
    const { decision } = await run({ recipient: "not-an-address", amount: "1.00" });
    expect(decision.outcome).toBe("deny");
    expect(decision.ruleId).toBe("fail_closed");
  });

  it("denies an unknown task", async () => {
    const { decision } = await run(VALID_PAY, "task_does_not_exist");
    expect(decision.outcome).toBe("deny");
    expect(decision.ruleId).toBe("fail_closed");
  });

  it("denies when the policy engine throws", async () => {
    deps.policy = {
      evaluate: () => {
        throw new Error("policy exploded");
      },
    };
    const { decision } = await run(VALID_PAY);
    expect(decision.outcome).toBe("deny");
    expect(decision.ruleId).toBe("fail_closed");
  });

  it("denies when the ledger throws", async () => {
    deps.ledger = {
      append: () => {},
      listByTask: () => {
        throw new Error("ledger unavailable");
      },
    };
    const { decision } = await run(VALID_PAY);
    expect(decision.outcome).toBe("deny");
  });

  it("does not pay when the audit write fails, even if policy allows", async () => {
    deps.policy = {
      evaluate: (proposal, origins) => ({
        proposalId: proposal.id,
        outcome: "allow",
        ruleId: "test-allow",
        reasonForUser: "",
        reasonForAgent: "",
        fieldOrigins: origins,
      }),
    };
    deps.audit = {
      record: () => {
        throw new Error("disk full");
      },
      recordTx: () => {},
    };
    const { decision } = await run(VALID_PAY);
    expect(decision.outcome).toBe("deny");
    expect(wallet.transfers).toHaveLength(0);
  });

  it("denies when the wallet throws", async () => {
    deps.policy = {
      evaluate: (proposal, origins) => ({
        proposalId: proposal.id,
        outcome: "allow",
        ruleId: "test-allow",
        reasonForUser: "",
        reasonForAgent: "",
        fieldOrigins: origins,
      }),
    };
    deps.wallet = {
      transfer: async () => {
        throw new Error("circle is down");
      },
      getBalance: async () => "0",
    };
    const { decision } = await run(VALID_PAY);
    expect(decision.outcome).toBe("deny");
  });

  it("denies by default while the policy engine is a stub", async () => {
    const { decision } = await run(VALID_PAY);
    expect(decision.outcome).toBe("deny");
    expect(decision.ruleId).toBe("stub.not_implemented");
    expect(wallet.transfers).toHaveLength(0);
  });

  it("records txHash in the audit log on successful payment", async () => {
    deps.policy = {
      evaluate: (proposal, origins) => ({
        proposalId: proposal.id,
        outcome: "allow",
        ruleId: "test-allow",
        reasonForUser: "",
        reasonForAgent: "",
        fieldOrigins: origins,
      }),
    };
    const { decision, txHash } = await run(VALID_PAY);
    expect(decision.outcome).toBe("allow");
    expect(txHash).toBeDefined();

    const row = db.prepare("SELECT tx_hash FROM audit_log WHERE proposal_id = ?").get(decision.proposalId) as { tx_hash: string };
    expect(row.tx_hash).toBe(txHash);
  });
});
