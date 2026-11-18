import { randomBytes } from "node:crypto";
import type { Approval, Decision, PaymentProposal, PendingApproval } from "@provn/shared";
import { ARC_TESTNET_CHAIN_ID, toBaseUnits } from "@provn/shared";
import { sha256Hex } from "../util.js";

/** How long the user has to decide before a pending payment expires. */
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

/** Why an approval or rejection was refused. The HTTP layer maps each to a status code. */
export type ApprovalErrorCode = "not_found" | "hash_mismatch" | "expired" | "already_decided";

export class ApprovalError extends Error {
  constructor(
    readonly code: ApprovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

/**
 * Human approval for payments the policy cannot decide alone.
 *
 * Each pending payment gets a hash of its exact details (chain, proposal, recipient, amount,
 * quantity, and a random nonce). The dashboard shows the details and sends the hash back when
 * the user approves, so an approval only ever covers the payment the user actually saw, and
 * can be used once.
 */
export interface ApprovalService {
  /** Queue a proposal for the user, with the decision that sent it here. */
  create(proposal: PaymentProposal, decision: Decision): PendingApproval;
  /**
   * Record the user's approval and hand back the proposal to execute. Single use: throws an
   * ApprovalError for an unknown or already-decided proposal, a wrong hash, or an expired one.
   */
  approve(
    proposalId: string,
    paymentHash: string,
    approvedBy: string,
  ): { approval: Approval; proposal: PaymentProposal };
  /** Record the user's rejection and hand back the proposal (for the audit log). */
  reject(proposalId: string, rejectedBy: string): { proposal: PaymentProposal };
  /** Drop pending approvals past their expiry. Returns how many were dropped. */
  expire(): number;
  /** Pending approvals that have not expired, oldest first. */
  listPending(): PendingApproval[];
}

type Entry = PendingApproval & { status: "pending" | "approved" | "rejected" | "expired" };

/**
 * In-memory approvals. Lost on restart, which only means pending payments have to be proposed
 * again: nothing is paid without an approval.
 * TODO: persist in SQLite if the demo needs approvals to survive a restart.
 */
export class InMemoryApprovalService implements ApprovalService {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs: number = DEFAULT_APPROVAL_TTL_MS,
  ) {}

  create(proposal: PaymentProposal, decision: Decision): PendingApproval {
    if (this.entries.has(proposal.id)) {
      throw new ApprovalError("already_decided", `Proposal ${proposal.id} is already queued`);
    }
    const pending: PendingApproval = {
      proposal,
      paymentHash: paymentHash(proposal, randomBytes(16).toString("hex")),
      expiresAt: new Date(this.now().getTime() + this.ttlMs).toISOString(),
      reasonForUser: decision.reasonForUser,
      fieldOrigins: decision.fieldOrigins,
    };
    this.entries.set(proposal.id, { ...pending, status: "pending" });
    return pending;
  }

  approve(
    proposalId: string,
    presentedHash: string,
    approvedBy: string,
  ): { approval: Approval; proposal: PaymentProposal } {
    const entry = this.pendingEntry(proposalId);
    if (presentedHash !== entry.paymentHash) {
      // Leave it pending: a stale dashboard can refresh and try again.
      throw new ApprovalError(
        "hash_mismatch",
        "The payment details changed. Refresh and check them again.",
      );
    }
    // Mark it used BEFORE anything is paid, so it can never be approved twice.
    entry.status = "approved";
    return {
      approval: {
        proposalId,
        paymentHash: entry.paymentHash,
        approvedBy,
        expiresAt: entry.expiresAt,
      },
      proposal: entry.proposal,
    };
  }

  reject(proposalId: string, _rejectedBy: string): { proposal: PaymentProposal } {
    const entry = this.pendingEntry(proposalId);
    entry.status = "rejected";
    return { proposal: entry.proposal };
  }

  expire(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "pending" && this.isExpired(entry)) {
        entry.status = "expired";
        count++;
      }
    }
    return count;
  }

  listPending(): PendingApproval[] {
    this.expire();
    return [...this.entries.values()]
      .filter((entry) => entry.status === "pending")
      .map(({ status: _status, ...pending }) => pending);
  }

  /** The entry for this proposal, if it is still waiting for a decision. Throws otherwise. */
  private pendingEntry(proposalId: string): Entry {
    const entry = this.entries.get(proposalId);
    if (!entry) throw new ApprovalError("not_found", `No pending payment ${proposalId}`);
    if (entry.status === "pending" && this.isExpired(entry)) entry.status = "expired";
    if (entry.status === "expired") {
      throw new ApprovalError("expired", "This payment request expired. Ask the agent again.");
    }
    if (entry.status !== "pending") {
      throw new ApprovalError(
        "already_decided",
        `Payment ${proposalId} was already ${entry.status}`,
      );
    }
    return entry;
  }

  private isExpired(entry: Entry): boolean {
    return Date.parse(entry.expiresAt) <= this.now().getTime();
  }
}

/** 0x + SHA-256 of the exact payment details. The nonce makes every request's hash unique. */
function paymentHash(proposal: PaymentProposal, nonce: string): string {
  const details = JSON.stringify([
    ARC_TESTNET_CHAIN_ID,
    proposal.id,
    proposal.recipient.toLowerCase(),
    toBaseUnits(proposal.amountUsdc),
    proposal.quantity ?? 1,
    nonce,
  ]);
  return `0x${sha256Hex(details)}`;
}
