import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryApprovalService } from "../src/approvals/index.js";
import { SqliteAuditLog } from "../src/audit/index.js";
import { openDatabase } from "../src/db.js";
import { FormIntake } from "../src/intake/index.js";
import { SqliteLedger } from "../src/ledger/index.js";
import { PaymentPipeline, type PipelineDeps } from "../src/payment/pipeline.js";
import { InMemoryPaymentHistory, loadPolicy, RulesPolicyEngine } from "../src/policy/index.js";
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
    const intake = new FormIntake(ledger);
    wallet = new MockWalletAdapter();
    const history = new InMemoryPaymentHistory();
    deps = {
      intake,
      ledger,
      trace: traceFields,
      policy: new RulesPolicyEngine(loadPolicy(), history),
      history,
      approvals: new InMemoryApprovalService(),
      wallet,
      audit: new SqliteAuditLog(db),
    };
    taskId = (await intake.createTask("Buy one market report")).id;
  });

  const run = async (input: unknown, id = taskId) =>
    (await new PaymentPipeline(deps).handlePay({ taskId: id, agentId: "agent-1" }, input)).decision;

  it("denies invalid input", async () => {
    const decision = await run({ recipient: "not-an-address", amount: "1.00" });
    expect(decision.outcome).toBe("deny");
    expect(decision.ruleId).toBe("fail_closed");
  });

  it("denies an unknown task", async () => {
    const decision = await run(VALID_PAY, "task_does_not_exist");
    expect(decision.outcome).toBe("deny");
    expect(decision.ruleId).toBe("fail_closed");
  });

  it("denies when the policy engine throws", async () => {
    deps.policy = {
      evaluate: () => {
        throw new Error("policy exploded");
      },
    };
    const decision = await run(VALID_PAY);
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
    const decision = await run(VALID_PAY);
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
    const decision = await run(VALID_PAY);
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
      kind: "failing",
      transfer: async () => {
        throw new Error("circle is down");
      },
      getStatus: async () => {
        throw new Error("circle is down");
      },
      pause: async () => ({ txHash: null }),
    };
    const decision = await run(VALID_PAY);
    expect(decision.outcome).toBe("deny");
  });

  it("denies a recipient that can't be traced to anything the task has seen", async () => {
    const decision = await run(VALID_PAY);
    expect(decision.outcome).toBe("deny");
    expect(decision.ruleId).toBe("deny-untrusted-or-unknown-recipient");
    expect(wallet.transfers).toHaveLength(0);
  });

  it("records the tx hash once a payment is sent", async () => {
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
    const { decision, txHash } = await new PaymentPipeline(deps).handlePay(
      { taskId, agentId: "agent-1" },
      VALID_PAY,
    );
    expect(decision.outcome).toBe("allow");
    expect(txHash).toMatch(/^0x/);
    const row = db
      .prepare("SELECT tx_hash, amount_base_units FROM payment_executions WHERE proposal_id = ?")
      .get(decision.proposalId);
    expect(row).toEqual({ tx_hash: txHash!.toLowerCase(), amount_base_units: "1000000" });
    expect(() => db.prepare("DELETE FROM payment_executions").run()).toThrow(/append-only/);
  });

  it("still reports a sent payment as sent if recording its tx hash fails", async () => {
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
      record: () => {},
      recordTx: () => {
        throw new Error("disk full");
      },
    };
    const { decision, txHash } = await new PaymentPipeline(deps).handlePay(
      { taskId, agentId: "agent-1" },
      VALID_PAY,
    );
    // Money moved: saying "deny" would invite the agent to pay again.
    expect(decision.outcome).toBe("allow");
    expect(txHash).toMatch(/^0x/);
    expect(wallet.transfers).toHaveLength(1);
  });
});
