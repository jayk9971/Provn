export type Trust = "TRUSTED" | "UNTRUSTED" | "DERIVED";
export type RecipientOrigin = "trusted" | "registry" | "untrusted" | "unknown";

export interface LedgerEntry {
  id: string;
  source: string;      // "user", "system", "tool:fetch_paid_data", "model"
  origin: string;      // e.g. "api.example.com/report"
  trust: Trust;
  hash: string;
  t: string;           // ISO timestamp
}

export interface Mandate {
  purpose: string;
  maxTotal: bigint;            // USDC base units (6 decimals)
  allowedVendors: string[];
  expires: string;
}

export interface PaymentProposal {
  proposalId: string;          // one-time ID, no replay
  agentId: string;
  actingFor: string;
  sessionId: string;
  recipient: string;           // 0x address, after alias resolution
  amount: bigint;              // USDC base units (6 decimals)
  memo: string;
  x402?: { payee: string; requestedHost: string };
}

export interface EnrichedProposal extends PaymentProposal {
  recipientOrigin: RecipientOrigin;
  mandate: Mandate;
  spentThisTask: bigint;
}

export type DecisionKind = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
export interface Decision { kind: DecisionKind; rule: string; reason: string }

// implemented by partner in gateway/src/policy/decide.ts (or stubbed)
export declare function decide(p: EnrichedProposal): Decision;
