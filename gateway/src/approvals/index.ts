import { db } from "../db.ts";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { executeVaultSupply?: any } from "../vault/index.ts";
import { executeVaultSpend } from "../vault/index.ts";
import { logAudit } from "../audit/index.ts";

const chainId = Number(process.env.ARC_CHAIN_ID || 50420);

export function createPendingApproval(proposal: {
  proposalId: string;
  recipient: string;
  amount: bigint;
}) {
  const approvalId = "app_" + Math.random().toString(36).substring(2, 11);
  const nonce = Math.floor(Math.random() * 1000000).toString();

  const paymentHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address recipient, uint256 amount, uint256 chainId, uint256 nonce"),
      [proposal.recipient as `0x${string}`, proposal.amount, BigInt(chainId), BigInt(nonce)]
    )
  );

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO approvals (approval_id, proposal_id, payment_hash, recipient, amount, chain_id, nonce, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    approvalId,
    proposal.proposalId,
    paymentHash,
    proposal.recipient,
    proposal.amount.toString(),
    chainId.toString(),
    nonce,
    expiresAt,
    createdAt
  );

  return { approvalId, paymentHash };
}

export async function approvePayment(approvalId: string, providedHash: string) {
  const approval: any = db.prepare(`SELECT * FROM approvals WHERE approval_id = ? AND status = 'pending'`).get(approvalId);
  if (!approval) {
    throw new Error("Approval not found or already processed.");
  }

  if (new Date() > new Date(approval.expires_at)) {
    db.prepare(`UPDATE approvals SET status = 'expired' WHERE approval_id = ?`).run(approvalId);
    throw new Error("Approval has expired.");
  }

  if (approval.payment_hash !== providedHash) {
    throw new Error("Payment hash mismatch.");
  }

  // Execute transaction through vault
  const txHash = await executeVaultSpend(approval.recipient, BigInt(approval.amount), approval.proposal_id as `0x${string}`);

  db.prepare(`UPDATE approvals SET status = 'approved' WHERE approval_id = ?`).run(approvalId);

  logAudit({
    proposalId: approval.proposal_id,
    decision: "ALLOW_VIA_APPROVAL",
    rule: "human-approval",
    reason: "Manually approved by human operator.",
    inputs: { recipient: approval.recipient, amount: approval.amount },
    provenance: { approvalId },
    txHash
  });

  return { success: true, txHash };
}

export function rejectPayment(approvalId: string) {
  const approval: any = db.prepare(`SELECT * FROM approvals WHERE approval_id = ? AND status = 'pending'`).get(approvalId);
  if (!approval) {
    throw new Error("Approval not found or already processed.");
  }

  db.prepare(`UPDATE approvals SET status = 'rejected' WHERE approval_id = ?`).run(approvalId);

  logAudit({
    proposalId: approval.proposal_id,
    decision: "DENY",
    rule: "human-rejection",
    reason: "Manually rejected by human operator.",
    inputs: { recipient: approval.recipient, amount: approval.amount },
    provenance: { approvalId }
  });

  return { success: true };
}
