import { describe, it, expect } from "vitest";
import { decide } from "../src/policy/decide.ts";
import { EnrichedProposal } from "../src/types.ts";

describe("Gateway Policy & Normalization Tests", () => {
  it("allows trusted proposals within mandate", () => {
    const proposal: EnrichedProposal = {
      proposalId: "0x123",
      agentId: "agent-1",
      actingFor: "user",
      sessionId: "s-1",
      recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      amount: 10n * 10n**6n,
      memo: "test",
      recipientOrigin: "trusted",
      mandate: {
        purpose: "Testing",
        maxTotal: 50n * 10n**6n,
        allowedVendors: [],
        expires: new Date().toISOString()
      },
      spentThisTask: 0n
    };

    const decision = decide(proposal);
    expect(decision.kind).toBe("ALLOW");
  });

  it("requires approval for untrusted origin", () => {
    const proposal: EnrichedProposal = {
      proposalId: "0x123",
      agentId: "agent-1",
      actingFor: "user",
      sessionId: "s-1",
      recipient: "0xBAD",
      amount: 10n * 10n**6n,
      memo: "test",
      recipientOrigin: "untrusted",
      mandate: {
        purpose: "Testing",
        maxTotal: 50n * 10n**6n,
        allowedVendors: [],
        expires: new Date().toISOString()
      },
      spentThisTask: 0n
    };

    const decision = decide(proposal);
    expect(decision.kind).toBe("REQUIRE_APPROVAL");
  });

  it("denies when amount exceeds mandate maxTotal", () => {
    const proposal: EnrichedProposal = {
      proposalId: "0x123",
      agentId: "agent-1",
      actingFor: "user",
      sessionId: "s-1",
      recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      amount: 100n * 10n**6n,
      memo: "test",
      recipientOrigin: "trusted",
      mandate: {
        purpose: "Testing",
        maxTotal: 50n * 10n**6n,
        allowedVendors: [],
        expires: new Date().toISOString()
      },
      spentThisTask: 0n
    };

    const decision = decide(proposal);
    expect(decision.kind).toBe("DENY");
  });
});
