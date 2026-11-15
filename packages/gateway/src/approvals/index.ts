import type { Approval, PaymentProposal, PendingApproval } from "@provn/shared";
import { NotImplementedError } from "../errors.js";

/**
 * Human approval for payments the policy cannot decide alone.
 * An approval is bound to a payment hash, so it only covers the exact payment the user saw.
 */
export interface ApprovalService {
  /** Queue a proposal for the user. Computes the payment hash. */
  create(proposal: PaymentProposal): PendingApproval;
  /** Record the user's approval. Must reject a wrong hash, an expired approval, or a reuse. */
  approve(proposalId: string, paymentHash: string, approvedBy: string): Approval;
  /** Drop pending approvals past their expiry. Returns how many were removed. */
  expire(now?: Date): number;
  listPending(): PendingApproval[];
}

export class StubApprovalService implements ApprovalService {
  create(_proposal: PaymentProposal): PendingApproval {
    // TODO: hash (recipient, amountUsdc, chain ID, nonce) into paymentHash, set an expiry
    // (e.g. 5 minutes), and store the pending approval.
    throw new NotImplementedError("ApprovalService.create");
  }

  approve(_proposalId: string, _paymentHash: string, _approvedBy: string): Approval {
    // TODO: look up the pending approval, check the hash and expiry, mark it used, and
    // return the Approval. The payment itself then goes through the wallet adapter.
    throw new NotImplementedError("ApprovalService.approve");
  }

  expire(_now: Date = new Date()): number {
    // TODO: remove or mark expired every pending approval whose expiresAt has passed.
    return 0;
  }

  listPending(): PendingApproval[] {
    // TODO: return real pending approvals.
    return [];
  }
}
