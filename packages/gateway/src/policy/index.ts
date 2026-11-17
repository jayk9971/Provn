import { readFileSync } from "node:fs";
import type { Decision, FieldOrigin, Mandate, PaymentProposal } from "@provn/shared";
import { fromBaseUnits, toBaseUnits } from "@provn/shared";
import { parse } from "yaml";
import type { PaymentHistory } from "./history.js";
import { PolicyFileSchema, type PolicyFile, type PolicyRule } from "./schema.js";

export type { PolicyFile, PolicyRule } from "./schema.js";
export { InMemoryPaymentHistory, type PaymentHistory, type PaymentRecord } from "./history.js";

/** policies/policy.yaml at the repo root, resolved from this file's location. */
export const DEFAULT_POLICY_PATH = new URL("../../../../policies/policy.yaml", import.meta.url);

/**
 * Load and validate a policy file. Throws if the file is missing or malformed, so the gateway
 * refuses to start with a broken policy (fail closed).
 */
export function loadPolicy(path: string | URL = DEFAULT_POLICY_PATH): PolicyFile {
  return PolicyFileSchema.parse(parse(readFileSync(path, "utf8")));
}

/** Decides whether a payment is allowed, denied, or needs the user's approval. */
export interface PolicyEngine {
  evaluate(proposal: PaymentProposal, origins: FieldOrigin[], mandate: Mandate): Decision;
}

/**
 * What the agent is told. Deliberately vague: the exact rule or limit would help an attacker
 * probe for what gets through. The dashboard shows the full reason.
 */
const REASON_FOR_AGENT: Record<Decision["outcome"], string> = {
  allow: "Payment approved.",
  deny: "Payment denied.",
  require_approval: "Payment needs the user's approval.",
};

type Origin = FieldOrigin["origin"];
type Conditions = PolicyRule["when"];

/** Everything a rule can look at, computed once per proposal. */
interface Facts {
  recipientOrigin: Origin;
  amountOrigin: Origin;
  quantityOrigin: Origin;
  isX402: boolean;
  inPlan: boolean;
  recipientIsNew: boolean;
  overMandateBudget: boolean;
  amount: bigint;
  spentToday: bigint;
}

/**
 * Evaluates policies/policy.yaml: the first rule whose `when` conditions all hold decides.
 * Then the floor (per-tx max, daily budget) is applied on top: it can turn an allow or an
 * approval into a deny, never the other way round. The vault enforces the same floor on-chain.
 *
 * Throws on malformed input (e.g. an amount that isn't valid USDC). The payment pipeline turns
 * any throw into a deny, so a bug here can never let a payment through.
 */
export class RulesPolicyEngine implements PolicyEngine {
  constructor(
    readonly policy: PolicyFile,
    private readonly history: PaymentHistory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  evaluate(proposal: PaymentProposal, origins: FieldOrigin[], mandate: Mandate): Decision {
    const facts = this.facts(proposal, origins, mandate);

    const rule = this.policy.rules.find((candidate) => matches(candidate.when, facts));
    if (!rule) {
      // Unreachable with a default rule last, but never fall through to "allow".
      return decision(proposal, origins, "deny", "no-rule-matched", "No policy rule matched.");
    }
    if (rule.outcome === "deny") {
      return decision(proposal, origins, "deny", rule.id, rule.reason);
    }

    const floorViolation = this.checkFloor(facts);
    if (floorViolation) return decision(proposal, origins, "deny", ...floorViolation);

    return decision(proposal, origins, rule.outcome, rule.id, rule.reason);
  }

  private facts(proposal: PaymentProposal, origins: FieldOrigin[], mandate: Mandate): Facts {
    const originOf = (field: string): Origin =>
      origins.find((o) => o.field === field)?.origin ?? "unknown"; // missing = assume the worst
    const recipientOrigin = originOf("recipient");
    const amount = BigInt(toBaseUnits(proposal.amountUsdc));
    const now = this.now();

    return {
      recipientOrigin,
      amountOrigin: originOf("amountUsdc"),
      quantityOrigin: originOf("quantity"),
      isX402: Boolean(proposal.requestedHost),
      inPlan: isInPlan(proposal, recipientOrigin, mandate, now),
      recipientIsNew: !this.history.hasPaid(proposal.recipient),
      overMandateBudget:
        this.history.spentByTask(proposal.taskId) + amount > limitToBaseUnits(mandate.maxTotalUsdc),
      amount,
      spentToday: this.history.spentOnDay(now),
    };
  }

  /** Returns [ruleId, reason] if the payment breaks a hard limit, otherwise null. */
  private checkFloor(facts: Facts): [string, string] | null {
    const perTxMax = limitToBaseUnits(this.policy.floor.per_tx_max_usdc);
    const dailyBudget = limitToBaseUnits(this.policy.floor.daily_budget_usdc);
    if (facts.amount > perTxMax) {
      return [
        "floor-per-tx-max",
        `This payment (${fromBaseUnits(facts.amount)} USDC) is over the per-payment limit of ` +
          `${fromBaseUnits(perTxMax)} USDC.`,
      ];
    }
    if (facts.spentToday + facts.amount > dailyBudget) {
      return [
        "floor-daily-budget",
        `This payment would take today's spending to ` +
          `${fromBaseUnits(facts.spentToday + facts.amount)} USDC, over the daily limit of ` +
          `${fromBaseUnits(dailyBudget)} USDC.`,
      ];
    }
    return null;
  }
}

/**
 * Convert a budget or limit to base units. Unlike a payment amount, a limit may be zero
 * ("spend nothing"), which `toBaseUnits` rejects on purpose.
 */
function limitToBaseUnits(limitUsdc: string): bigint {
  return /^0+(\.0+)?$/.test(limitUsdc.trim()) ? 0n : BigInt(toBaseUnits(limitUsdc));
}

/** A rule matches when every condition it lists holds. An empty `when` always matches. */
function matches(when: Conditions, facts: Facts): boolean {
  const checks: boolean[] = [];
  if (when.recipient_origin_in) {
    checks.push(when.recipient_origin_in.includes(facts.recipientOrigin));
  }
  if (when.recipient_not_bound_to_requested_host !== undefined) {
    // Only meaningful for x402 payments (there is a host being paid). A direct transfer to an
    // address the user typed has no 402 behind it, so it is never "not bound".
    const notBound = facts.isX402 && facts.recipientOrigin !== "bound";
    checks.push(notBound === when.recipient_not_bound_to_requested_host);
  }
  if (when.not_in_plan !== undefined) {
    checks.push(!facts.inPlan === when.not_in_plan);
  }
  if (when.amount_or_quantity_origin_in) {
    const listed = when.amount_or_quantity_origin_in;
    checks.push(listed.includes(facts.amountOrigin) || listed.includes(facts.quantityOrigin));
  }
  if (when.recipient_is_new !== undefined) {
    checks.push(facts.recipientIsNew === when.recipient_is_new);
  }
  if (when.over_mandate_budget !== undefined) {
    checks.push(facts.overMandateBudget === when.over_mandate_budget);
  }
  return checks.every(Boolean);
}

/**
 * Is this payment part of what the user asked for?
 * Yes if the mandate hasn't expired and either the user named the recipient themselves, or the
 * host being paid (or the recipient address) is one of the mandate's allowed vendors.
 */
function isInPlan(
  proposal: PaymentProposal,
  recipientOrigin: Origin,
  mandate: Mandate,
  now: Date,
): boolean {
  if (Date.parse(mandate.expiresAt) <= now.getTime()) return false;
  if (recipientOrigin === "trusted") return true;

  const allowed = new Set(mandate.allowedVendors.map(normalizeVendor));
  if (allowed.has(normalizeVendor(proposal.recipient))) return true;
  return proposal.requestedHost ? allowed.has(normalizeVendor(proposal.requestedHost)) : false;
}

/**
 * Lowercase, and drop a scheme, port, path or trailing dot, so "paid-api.example" matches
 * "https://Paid-API.example:3002/report". Addresses are just lowercased.
 */
function normalizeVendor(vendor: string): string {
  const trimmed = vendor.trim().toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(trimmed)) return trimmed;
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//, "");
  return (withoutScheme.split(/[/:?#]/)[0] ?? "").replace(/\.$/, "");
}

function decision(
  proposal: PaymentProposal,
  origins: FieldOrigin[],
  outcome: Decision["outcome"],
  ruleId: string,
  reasonForUser: string,
): Decision {
  return {
    proposalId: proposal.id,
    outcome,
    ruleId,
    reasonForUser,
    reasonForAgent: REASON_FOR_AGENT[outcome],
    fieldOrigins: origins,
  };
}