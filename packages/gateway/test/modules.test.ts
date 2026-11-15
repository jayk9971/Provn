import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { StubFetcher } from "../src/fetcher/index.js";
import { StubIntake } from "../src/intake/index.js";
import { SqliteLedger } from "../src/ledger/index.js";
import { loadPolicy } from "../src/policy/index.js";
import { traceFields } from "../src/trace/index.js";
import { MockWalletAdapter } from "../src/wallet/index.js";
import { MandateSchema } from "../src/validation.js";

function setup() {
  const db = openDatabase(":memory:");
  const ledger = new SqliteLedger(db);
  return { db, ledger };
}

describe("ledger", () => {
  it("appends entries and lists them by task", async () => {
    const { ledger } = setup();
    const intake = new StubIntake(ledger);
    const taskA = await intake.createTask("task A request");
    const taskB = await intake.createTask("task B request");
    expect(ledger.listByTask(taskA.id).map((entry) => entry.content)).toEqual(["task A request"]);
    expect(ledger.listByTask(taskB.id)).toHaveLength(1);
  });

  it("is append-only", async () => {
    const { db, ledger } = setup();
    const task = await new StubIntake(ledger).createTask("hello");
    expect(() => db.prepare("DELETE FROM ledger_entries").run()).toThrow(/append-only/);
    expect(ledger.listByTask(task.id)).toHaveLength(1);
  });
});

describe("intake", () => {
  it("records the user request as trusted and returns a valid mandate", async () => {
    const { ledger } = setup();
    const task = await new StubIntake(ledger).createTask("Buy one report");
    const [entry] = ledger.listByTask(task.id);
    expect(entry?.trust).toBe("trusted");
    expect(entry?.source).toBe("user");
    expect(MandateSchema.safeParse(task.mandate).success).toBe(true);
  });
});

describe("fetcher", () => {
  it("labels fetched content untrusted", async () => {
    const { ledger } = setup();
    const result = await new StubFetcher(ledger).fetch("task_1", "https://vendor.example/report");
    expect(result.entries.every((entry) => entry.trust === "untrusted")).toBe(true);
    expect(result.entries.some((entry) => entry.trust === "bound")).toBe(false);
  });
});

describe("trace", () => {
  it("stub reports every field as unknown", () => {
    const { ledger } = setup();
    const origins = traceFields(
      {
        id: "p1",
        taskId: "t1",
        agentId: "a1",
        recipient: "0xabc",
        amountUsdc: "1.00",
        quantity: 2,
      },
      ledger,
    );
    expect(origins.map((o) => o.field)).toEqual(["recipient", "amountUsdc", "quantity"]);
    expect(origins.every((o) => o.origin === "unknown")).toBe(true);
  });
});

describe("policy file", () => {
  it("policies/policy.yaml parses and ends with a default allow rule", () => {
    const policy = loadPolicy();
    expect(policy.rules.length).toBeGreaterThan(0);
    expect(policy.rules.at(-1)?.id).toBe("allow-default");
    expect(policy.rules[0]?.outcome).toBe("deny");
  });
});

describe("mock wallet", () => {
  it("records transfers", async () => {
    const wallet = new MockWalletAdapter();
    const { txHash } = await wallet.transfer("0xabc", "1.00");
    expect(txHash).toMatch(/^0xmock/);
    expect(wallet.transfers).toEqual([{ to: "0xabc", amountUsdc: "1.00" }]);
  });
});
