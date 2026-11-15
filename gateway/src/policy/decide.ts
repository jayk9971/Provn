import { EnrichedProposal, Decision } from "../types.ts";

export function decide(p: EnrichedProposal): Decision {
  // Until partner's policy engine is fully connected, check basic safety and return ALLOW or REQUIRE_APPROVAL
  if (p.recipientOrigin === "untrusted" || p.recipientOrigin === "unknown") {
    return {
      kind: "REQUIRE_APPROVAL",
      rule: "trusted-origin",
      reason: "Recipient origin is untrusted or unknown, requiring human approval."
    };
  }

  if (p.amount > p.mandate.maxTotal) {
    return {
      kind: "DENY",
      rule: "max-per-tx",
      reason: "Payment amount exceeds active mandate maximum."
    };
  }

  return {
    kind: "ALLOW",
    rule: "default-allow",
    reason: "Proposal complies with mandate and trust policies."
  };
}
