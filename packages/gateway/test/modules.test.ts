import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { HttpFetcher } from "../src/fetcher/index.js";
import { FormIntake } from "../src/intake/index.js";
import { SqliteLedger } from "../src/ledger/index.js";
import { loadPolicy } from "../src/policy/index.js";
import { parseBoundPayment, traceFields } from "../src/trace/index.js";
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
    const intake = new FormIntake(ledger);
    const taskA = await intake.createTask("task A request");
    const taskB = await intake.createTask("task B request");
    expect(ledger.listByTask(taskA.id).map((entry) => entry.content)).toEqual(["task A request"]);
    expect(ledger.listByTask(taskB.id)).toHaveLength(1);
  });

  it("is append-only", async () => {
    const { db, ledger } = setup();
    const task = await new FormIntake(ledger).createTask("hello");
    expect(() => db.prepare("DELETE FROM ledger_entries").run()).toThrow(/append-only/);
    expect(ledger.listByTask(task.id)).toHaveLength(1);
  });
});

describe("intake", () => {
  it("records the user request as trusted and returns a valid mandate", async () => {
    const { ledger } = setup();
    const task = await new FormIntake(ledger).createTask("Buy one report");
    const [entry] = ledger.listByTask(task.id);
    expect(entry?.trust).toBe("trusted");
    expect(entry?.source).toBe("user");
    expect(MandateSchema.safeParse(task.mandate).success).toBe(true);
  });
});

describe("fetcher", () => {
  const PAYEE = "0x" + "aB".repeat(20);
  const respond = (body: string, status = 200) =>
    (async () => new Response(body, { status })) as typeof fetch;

  it("labels fetched content untrusted", async () => {
    const { ledger } = setup();
    const result = await new HttpFetcher(ledger, respond("hello")).fetch(
      "task_1",
      "https://vendor.example/report",
    );
    expect(result.status).toBe(200);
    expect(result.body).toBe("hello");
    expect(result.entries.map((entry) => entry.trust)).toEqual(["untrusted"]);
    expect(result.paymentRequired).toBeUndefined();
  });

  it("records a 402's payee and price as bound, in the format trace reads", async () => {
    const { ledger } = setup();
    const body = JSON.stringify({ price: "0.05", payee: PAYEE, note: "pay me" });
    const result = await new HttpFetcher(ledger, respond(body, 402)).fetch(
      "task_1",
      "https://vendor.example:3002/report",
    );
    expect(result.paymentRequired).toEqual({
      payee: PAYEE,
      price: "0.05",
      host: "vendor.example:3002",
    });
    const [untrusted, bound] = result.entries;
    expect(untrusted?.trust).toBe("untrusted");
    expect(untrusted?.content).toBe(body);
    expect(bound?.trust).toBe("bound");
    expect(bound?.origin).toBe("vendor.example:3002");
    expect(parseBoundPayment(bound!.content)).toEqual({
      payee: PAYEE.toLowerCase(),
      price: "0.05",
      url: "https://vendor.example:3002/report",
    });
  });

  it("ignores a 402 without a valid payee", async () => {
    const { ledger } = setup();
    const body = JSON.stringify({ price: "0.05", payee: "send it to bob" });
    const result = await new HttpFetcher(ledger, respond(body, 402)).fetch(
      "task_1",
      "https://vendor.example/report",
    );
    expect(result.paymentRequired).toBeUndefined();
    expect(result.entries.map((entry) => entry.trust)).toEqual(["untrusted"]);
  });

  it("blocks redirects", async () => {
    const { ledger } = setup();
    await expect(
      new HttpFetcher(ledger, respond("", 302)).fetch("task_1", "https://vendor.example/r"),
    ).rejects.toThrow(/Redirect blocked/);
  });

  it("truncates long bodies", async () => {
    const { ledger } = setup();
    const longBody = "a".repeat(300 * 1024);
    const result = await new HttpFetcher(ledger, respond(longBody)).fetch(
      "task_1",
      "https://x.y/z",
    );
    expect(result.body).toContain("[truncated: exceeded 200 KB limit]");
    expect(result.body.length).toBeLessThan(longBody.length);
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
    const { txHash } = await wallet.transfer({
      idempotencyKey: "prop_1",
      to: "0xabc",
      amountUsdc: "1.00",
    });
    expect(txHash).toMatch(/^0xmock/);
    expect(wallet.transfers).toEqual([{ to: "0xabc", amountUsdc: "1.00", txHash }]);
  });
});
