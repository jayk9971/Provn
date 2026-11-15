import { readFileSync } from "node:fs";
import type { Decision, FieldOrigin, Mandate, PaymentProposal } from "@provn/shared";
import { parse } from "yaml";
import { PolicyFileSchema, type PolicyFile } from "./schema.js";

export type { PolicyFile, PolicyRule } from "./schema.js";

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

export class StubPolicyEngine implements PolicyEngine {
  constructor(readonly policy: PolicyFile) {}

  evaluate(proposal: PaymentProposal, origins: FieldOrigin[], _mandate: Mandate): Decision {
    // TODO: walk `this.policy.rules` top to bottom; the first rule whose `when` conditions all
    // hold decides. Then apply `this.policy.floor` (per-tx max, daily budget) on top.
    // Until then, deny everything: the safe default.
    return {
      proposalId: proposal.id,
      outcome: "deny",
      ruleId: "stub.not_implemented",
      reasonForUser: "Policy engine is not implemented yet, so all payments are denied.",
      reasonForAgent: "Payment denied.",
      fieldOrigins: origins,
    };
  }
}
