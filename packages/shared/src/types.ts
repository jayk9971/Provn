/**
 * Shared domain types for Provn.
 *
 * Conventions used by every type in this file:
 * - Timestamps are ISO-8601 strings (JSON-safe).
 * - USDC amounts are decimal strings in whole USDC, e.g. "0.05" (JSON-safe, no float rounding).
 *   They always refer to the ERC-20 interface with 6 decimals. See `constants.ts`.
 */

/**
 * How much Provn trusts a piece of content, from least to most surprising:
 * - `trusted`   : typed by the user, recorded by the gateway itself.
 * - `bound`     : the payee in an x402-style 402 response from the host being paid.
 *                 It is the vendor's own payment channel, so it is trusted for that host only.
 * - `untrusted` : anything the gateway fetched from outside. Never a source of payment details.
 * - `derived`   : computed by the agent or the model from other entries. Trust is only as good
 *                 as its inputs, so policy treats it with suspicion.
 */
export type TrustLabel = "trusted" | "bound" | "untrusted" | "derived";

/** One immutable record in the provenance ledger: a piece of content and where it came from. */
export interface LedgerEntry {
  id: string;
  /** What produced the content, e.g. "user" or "tool:fetch_paid_data". */
  source: string;
  /** URL or host the content came from, or null when it has no outside origin (e.g. the user). */
  origin: string | null;
  trust: TrustLabel;
  /** SHA-256 hex digest of `content`. */
  contentHash: string;
  content: string;
  createdAt: string;
  taskId: string;
}

/** What the user authorized for one task. Extracted from the trusted user request. */
export interface Mandate {
  taskId: string;
  /** Plain-language purpose of the task, e.g. "Buy one market report". */
  purpose: string;
  /** Maximum total spend for the task, in USDC (decimal string). */
  maxTotalUsdc: string;
  /** Hosts or addresses the user said the agent may pay. */
  allowedVendors: string[];
  expiresAt: string;
}

/** A task created from a trusted user request. */
export interface Task {
  id: string;
  /** The user's original request. Recorded in the ledger as `trusted`. */
  userRequest: string;
  mandate: Mandate;
  createdAt: string;
}

/** A payment the agent asks the gateway to make. The agent never moves money itself. */
export interface PaymentProposal {
  /** One-time ID. A proposal can be decided and executed at most once. */
  id: string;
  taskId: string;
  agentId: string;
  /** 0x-prefixed recipient address. */
  recipient: string;
  /** Amount in USDC (decimal string, ERC-20 semantics, 6 decimals). */
  amountUsdc: string;
  quantity?: number;
  memo?: string;
  /** Host the agent says it is paying, e.g. "api.vendor.example". Used to find the bound payee. */
  requestedHost?: string;
}

/** Where one field of a proposal (recipient, amount, quantity) came from. */
export interface FieldOrigin {
  /** Field name on `PaymentProposal`, e.g. "recipient". */
  field: string;
  /** The field's value as proposed. */
  value: string;
  /** Trust label of the ledger entry the value was traced to, or "unknown" if no entry matches. */
  origin: TrustLabel | "unknown";
  /** The ledger entry the value was traced to, when there is one. */
  ledgerEntryId?: string;
}

/** The gateway's verdict on a proposal. */
export interface Decision {
  proposalId: string;
  outcome: "allow" | "deny" | "require_approval";
  /** ID of the policy rule that matched, e.g. "deny-untrusted-recipient". */
  ruleId: string;
  /** Full explanation, shown to the user in the dashboard. */
  reasonForUser: string;
  /** Short explanation returned to the agent. Must not leak details that help an attacker. */
  reasonForAgent: string;
  fieldOrigins: FieldOrigin[];
}

/** A user's approval of one specific payment. Bound to a hash so it cannot be reused. */
export interface Approval {
  proposalId: string;
  /** Hash of the exact payment details the user approved (recipient, amount, chain, nonce). */
  paymentHash: string;
  approvedBy: string;
  expiresAt: string;
}

/** A proposal waiting for the user's decision. Returned by `GET /approvals`. */
export interface PendingApproval {
  proposal: PaymentProposal;
  /** Send this back unchanged when approving: it binds the approval to these exact details. */
  paymentHash: string;
  expiresAt: string;
  /** Why the policy wanted the user to decide, e.g. "This is the first payment to this recipient." */
  reasonForUser: string;
  /** Where each payment field came from, for the dashboard to show. */
  fieldOrigins: FieldOrigin[];
}

/**
 * Result of approving or rejecting a pending payment. Returned by
 * `POST /approvals/:id/approve` and `POST /approvals/:id/reject`.
 */
export interface ApprovalResult {
  /** Present when the user approved; null when they rejected. */
  approval: Approval | null;
  /**
   * What happened next. "allow" means the payment was sent; "deny" means it was not (the user
   * rejected it, or it now breaks a hard limit, or the payment failed). See `ruleId`.
   */
  decision: Decision;
  /** Onchain transaction hash if the payment was sent, otherwise null. */
  txHash: string | null;
}
