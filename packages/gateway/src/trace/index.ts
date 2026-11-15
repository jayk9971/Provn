import type { FieldOrigin, PaymentProposal } from "@provn/shared";
import type { Ledger } from "../ledger/index.js";

/** Function shape of `traceFields`, so the payment pipeline can be given a fake in tests. */
export type TraceFields = (proposal: PaymentProposal, ledger: Ledger) => FieldOrigin[];

/**
 * Work out where each field of a proposal (recipient, amount, quantity) came from.
 *
 * TODO: for each field, find the ledger entry the value appears in and report that entry's
 * trust label. Cover encoded values (e.g. base64), which must come out as "derived" or
 * "untrusted", never "trusted". If no entry matches, report "unknown".
 */
export const traceFields: TraceFields = (proposal, ledger) => {
  void ledger.listByTask(proposal.taskId); // TODO: search these entries for each field value.

  // Stub: claim nothing is known. "unknown" can never pass a policy that requires trusted data.
  const fields: FieldOrigin[] = [
    { field: "recipient", value: proposal.recipient, origin: "unknown" },
    { field: "amountUsdc", value: proposal.amountUsdc, origin: "unknown" },
  ];
  if (proposal.quantity !== undefined) {
    fields.push({ field: "quantity", value: String(proposal.quantity), origin: "unknown" });
  }
  return fields;
};
