import type { FieldOrigin, Mandate, PaymentProposal } from "@provn/shared";
import { describe, expect, it } from "vitest";
import {
  InMemoryPaymentHistory,
  loadPolicy,
  RulesPolicyEngine,
  type PolicyFile,
} from "../src/policy/index.js";

const NOW = new Date("2026-11-18T15:00:00Z");
const VENDOR = "0x1111111111111111111111111111111111111111";
const HOST = "paid-api.example";

const MANDATE: Mandate = {
  taskId: "task_1",
  purpose: "Research the EV battery market",
  maxTotalUsdc: "10",
  allowedVendors: [HOST],
  expiresAt: "2026-11-19T00:00:00Z",
};

type Origin = FieldOrigin["origin"];

function origins(recipient: Origin, amountUsdc: Origin = "bound", quantity: Origin = "trusted") {
  return [
    { field: "recipient", value: VENDOR, origin: recipient },
    { field: "amountUsdc", value: "0.05", origin: amountUsdc },
    { field: "quantity", value: "1", origin: quantity },
  ] satisfies FieldOrigin[];
}

function proposal(overrides: Partial<PaymentProposal> = {}): PaymentProposal {
  return {
    id: "prop_1",
    taskId: "task_1",
    agentId: "agent_1",
    recipient: VENDOR,
    amountUsdc: "0.05",
    requestedHost: HOST,
    ...overrides,
  };
}

function engine(options: { known?: string[]; policy?: PolicyFile } = {}) {
  const history = new InMemoryPaymentHistory(options.known ?? []);
  const policy = new RulesPolicyEngine(options.policy ?? loadPolicy(), history, () => NOW);
  return { policy, history };
}

/** Evaluate and return [outcome, ruleId]. */
function decide(
  e: RulesPolicyEngine,
  p: Partial<PaymentProposal>,
  o: FieldOrigin[],
  m: Mandate = MANDATE,
) {
  const d = e.evaluate(proposal(p), o, m);
  return [d.outcome, d.ruleId];
}

describe("policy: demo scenarios", () => {
  it("step 2: normal x402 payment to a known vendor in the plan is allowed", () => {
    const { policy } = engine({ known: [VENDOR] });
    expect(decide(policy, {}, origins("bound"))).toEqual(["allow", "allow-default"]);
  });

  it("step 2: the FIRST payment to a vendor's address needs approval (trust on first use)", () => {
    const { policy } = engine();
    expect(decide(policy, {}, origins("bound"))).toEqual([
      "require_approval",
      "approve-new-recipient",
    ]);
  });

  it("after a confirmed payment, the recipient is no longer new", () => {
    const { policy, history } = engine();
    history.record({ taskId: "task_1", recipient: VENDOR, amountUsdc: "0.05", at: NOW });
    expect(decide(policy, {}, origins("bound"))[0]).toBe("allow");
  });

  it("step 3: an injected quantity is denied even though the vendor is legitimate", () => {
    const { policy } = engine({ known: [VENDOR] });
    expect(
      decide(
        policy,
        { quantity: 10, amountUsdc: "0.5" },
        origins("bound", "untrusted", "untrusted"),
      ),
    ).toEqual(["deny", "deny-untrusted-quantity-or-amount"]);
  });

  it("step 4: a recipient from outside content is denied", () => {
    const { policy } = engine();
    expect(decide(policy, { requestedHost: undefined }, origins("untrusted"))).toEqual([
      "deny",
      "deny-untrusted-or-unknown-recipient",
    ]);
  });

  it("step 5: a recipient that can't be traced (encoded attack) is denied", () => {
    const { policy } = engine();
    expect(decide(policy, { requestedHost: undefined }, origins("unknown"))).toEqual([
      "deny",
      "deny-untrusted-or-unknown-recipient",
    ]);
  });

  it("step 6: a vendor outside the plan needs approval", () => {
    const { policy } = engine({ known: [VENDOR] });
    expect(decide(policy, { requestedHost: "found-via-search.example" }, origins("bound"))).toEqual(
      ["require_approval", "approve-payment-not-in-plan"],
    );
  });
});

describe("policy: rules", () => {
  it("x402 payment whose payee did not come from the 402 is denied", () => {
    const { policy } = engine({ known: [VENDOR] });
    expect(decide(policy, {}, origins("trusted"))).toEqual([
      "deny",
      "deny-payee-not-from-402-of-requested-host",
    ]);
  });

  it("a direct transfer to an address the user typed is NOT denied for lacking a 402", () => {
    const { policy } = engine({ known: [VENDOR] });
    const o = origins("trusted", "trusted");
    expect(decide(policy, { requestedHost: undefined }, o)).toEqual(["allow", "allow-default"]);
  });

  it("an expired mandate puts every payment outside the plan", () => {
    const { policy } = engine({ known: [VENDOR] });
    const expired = { ...MANDATE, expiresAt: "2026-11-18T14:59:59Z" };
    expect(decide(policy, {}, origins("bound"), expired)).toEqual([
      "require_approval",
      "approve-payment-not-in-plan",
    ]);
  });

  it("allowed vendors match regardless of case, scheme, port and path", () => {
    const { policy } = engine({ known: [VENDOR] });
    const mandate = { ...MANDATE, allowedVendors: ["https://Paid-API.example/reports"] };
    expect(
      decide(policy, { requestedHost: "paid-api.example:3002" }, origins("bound"), mandate)[0],
    ).toBe("allow");
  });

  it("an allowed vendor can also be listed by address", () => {
    const { policy } = engine({ known: [VENDOR] });
    const mandate = { ...MANDATE, allowedVendors: [VENDOR.toUpperCase().replace("0X", "0x")] };
    expect(decide(policy, { requestedHost: "other.example" }, origins("bound"), mandate)[0]).toBe(
      "allow",
    );
  });

  it("a payment that would exceed the task budget needs approval", () => {
    const { policy, history } = engine({ known: [VENDOR] });
    history.record({ taskId: "task_1", recipient: VENDOR, amountUsdc: "9.98", at: NOW });
    expect(decide(policy, {}, origins("bound"))).toEqual([
      "require_approval",
      "approve-over-mandate-budget",
    ]);
  });

  it("spending on other tasks does not count toward this task's budget", () => {
    const { policy, history } = engine({ known: [VENDOR] });
    history.record({ taskId: "task_2", recipient: VENDOR, amountUsdc: "9.98", at: NOW });
    expect(decide(policy, {}, origins("bound"))[0]).toBe("allow");
  });

  it("a zero budget is valid: any payment is over it", () => {
    const { policy } = engine({ known: [VENDOR] });
    const zero = { ...MANDATE, maxTotalUsdc: "0" };
    expect(decide(policy, {}, origins("bound"), zero)).toEqual([
      "require_approval",
      "approve-over-mandate-budget",
    ]);
    expect(decide(policy, { requestedHost: undefined }, origins("unknown"), zero)).toEqual([
      "deny",
      "deny-untrusted-or-unknown-recipient",
    ]);
  });

  it("a missing origin is treated as unknown", () => {
    const { policy } = engine({ known: [VENDOR] });
    expect(decide(policy, {}, [])).toEqual(["deny", "deny-untrusted-or-unknown-recipient"]);
  });

  it("if no rule matches, the payment is denied, never allowed", () => {
    const base = loadPolicy();
    const noDefault: PolicyFile = {
      ...base,
      rules: base.rules.filter((rule) => rule.id !== "allow-default"),
    };
    const { policy } = engine({ known: [VENDOR], policy: noDefault });
    expect(decide(policy, {}, origins("bound"))).toEqual(["deny", "no-rule-matched"]);
  });
});

describe("policy: floor", () => {
  it("a payment over the per-tx max is denied even when the rules would allow it", () => {
    const { policy } = engine({ known: [VENDOR] });
    const mandate = { ...MANDATE, maxTotalUsdc: "100" };
    expect(decide(policy, { amountUsdc: "5.01" }, origins("bound"), mandate)).toEqual([
      "deny",
      "floor-per-tx-max",
    ]);
  });

  it("the floor also overrides 'needs approval': the vault would refuse it anyway", () => {
    // A new recipient would need approval; at 6 USDC the floor denies it first.
    const { policy } = engine();
    const d = policy.evaluate(proposal({ amountUsdc: "6" }), origins("bound", "bound"), MANDATE);
    expect([d.outcome, d.ruleId]).toEqual(["deny", "floor-per-tx-max"]);
    expect(d.reasonForUser).toContain("6 USDC");
  });

  it("a deny rule keeps its own reason even when the floor is also broken", () => {
    const { policy } = engine();
    expect(
      decide(policy, { amountUsdc: "6", requestedHost: undefined }, origins("untrusted")),
    ).toEqual(["deny", "deny-untrusted-or-unknown-recipient"]);
  });

  it("today's spending counts toward the daily budget; yesterday's doesn't", () => {
    const { policy, history } = engine({ known: [VENDOR] });
    const mandate = { ...MANDATE, maxTotalUsdc: "100" };
    history.record({
      taskId: "t",
      recipient: VENDOR,
      amountUsdc: "5",
      at: new Date("2026-11-17T23:59:59Z"),
    });
    expect(decide(policy, { amountUsdc: "5" }, origins("bound"), mandate)[0]).toBe("allow");

    // 15.02 spent today: 4.98 more lands exactly on the 20 limit (allowed), 5 goes over.
    for (let i = 0; i < 3; i++) {
      history.record({ taskId: "t", recipient: VENDOR, amountUsdc: "5", at: NOW });
    }
    history.record({ taskId: "t", recipient: VENDOR, amountUsdc: "0.02", at: NOW });
    expect(decide(policy, { amountUsdc: "5" }, origins("bound"), mandate)).toEqual([
      "deny",
      "floor-daily-budget",
    ]);
    expect(decide(policy, { amountUsdc: "4.98" }, origins("bound"), mandate)[0]).toBe("allow");
  });
});

describe("policy: what the agent sees", () => {
  it("is vague, so an attacker can't probe the rules", () => {
    const { policy } = engine();
    const deny = policy.evaluate(
      proposal({ requestedHost: undefined }),
      origins("untrusted"),
      MANDATE,
    );
    const approval = policy.evaluate(proposal(), origins("bound"), MANDATE);
    expect(deny.reasonForAgent).toBe("Payment denied.");
    expect(approval.reasonForAgent).toBe("Payment needs the user's approval.");
    expect(deny.reasonForUser).not.toBe(deny.reasonForAgent);
  });
});

describe("payment history", () => {
  it("tracks spend by task and by UTC day, and known recipients case-insensitively", () => {
    const history = new InMemoryPaymentHistory();
    history.record({
      taskId: "a",
      recipient: VENDOR.toUpperCase().replace("0X", "0x"),
      amountUsdc: "1.5",
      at: NOW,
    });
    history.record({
      taskId: "a",
      recipient: VENDOR,
      amountUsdc: "0.25",
      at: new Date("2026-11-17T12:00:00Z"),
    });
    history.record({ taskId: "b", recipient: VENDOR, amountUsdc: "2", at: NOW });
    expect(history.spentByTask("a")).toBe(1_750_000n);
    expect(history.spentOnDay(NOW)).toBe(3_500_000n);
    expect(history.hasPaid(VENDOR)).toBe(true);
    expect(history.hasPaid("0x2222222222222222222222222222222222222222")).toBe(false);
  });
});
