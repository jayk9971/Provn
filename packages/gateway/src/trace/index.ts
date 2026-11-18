import type { FieldOrigin, LedgerEntry, PaymentProposal, TrustLabel } from "@provn/shared";
import { toBaseUnits } from "@provn/shared";
import type { Ledger } from "../ledger/index.js";
import { parseBoundPayment, type BoundPayment } from "./bound.js";

export { parseBoundPayment, serializeBoundPayment, type BoundPayment } from "./bound.js";

/** Function shape of `traceFields`, so the payment pipeline can be given a fake in tests. */
export type TraceFields = (proposal: PaymentProposal, ledger: Ledger) => FieldOrigin[];

type Origin = TrustLabel | "unknown";

/** Higher = more trusted. When a value appears in several entries, the most trusted one wins. */
const RANK: Record<Origin, number> = {
  trusted: 4,
  bound: 3,
  untrusted: 2,
  derived: 1,
  unknown: 0,
};

export const traceFields: TraceFields = (proposal, ledger) => {
  const entries = ledger.listByTask(proposal.taskId);
  const bound = findBoundPayment(entries, proposal);

  const recipient = traceRecipient(proposal.recipient, entries, bound);
  const quantity = traceQuantity(proposal.quantity, entries);
  const amount = traceAmount(proposal.amountUsdc, proposal.quantity, entries, bound, quantity);

  return [recipient, amount, quantity];
};

/** The latest well-formed bound entry from the requested host whose payee is the recipient. */
function findBoundPayment(
  entries: LedgerEntry[],
  proposal: PaymentProposal,
): { entry: LedgerEntry; payment: BoundPayment } | null {
  if (!proposal.requestedHost) return null;
  const host = proposal.requestedHost.toLowerCase();
  const recipient = proposal.recipient.toLowerCase();
  for (const entry of [...entries].reverse()) {
    if (entry.trust !== "bound" || entry.origin?.toLowerCase() !== host) continue;
    const payment = parseBoundPayment(entry.content);
    if (payment && payment.payee === recipient) return { entry, payment };
  }
  return null;
}

function traceRecipient(
  recipient: string,
  entries: LedgerEntry[],
  bound: { entry: LedgerEntry } | null,
): FieldOrigin {
  const value = recipient;
  if (bound) return { field: "recipient", value, origin: "bound", ledgerEntryId: bound.entry.id };

  // Exact address, not part of a longer hex string. Bound entries are excluded on purpose:
  // a 402 payee only counts through findBoundPayment's host check above.
  const pattern = new RegExp(`(?<![0-9a-f])${escapeRegExp(recipient.toLowerCase())}(?![0-9a-f])`);
  const match = bestMatch(
    entries.filter((e) => e.trust !== "bound"),
    (entry) => pattern.test(entry.content.toLowerCase()),
  );
  return withMatch("recipient", value, match);
}

function traceQuantity(quantity: number | undefined, entries: LedgerEntry[]): FieldOrigin {
  if (quantity === undefined || quantity === 1) {
    // The default: the agent added nothing. No ledger entry to point at.
    return { field: "quantity", value: String(quantity ?? 1), origin: "trusted" };
  }
  const value = String(quantity);
  // Whole number: not part of a longer number or a decimal ("0.10", "10.5"), but a sentence-
  // ending period is fine ("buy 10."). Money and percentages are not quantities: without this,
  // a user's "up to $10" would make an injected "buy 10 units" look like the user's choice.
  const pattern = new RegExp(
    `(?<!\\d|\\d\\.|\\$\\s?)${quantity}(?!\\d|\\.\\d|\\s?(?:%|usdc\\b|usd\\b|dollars?\\b|cents?\\b))`,
    "i",
  );
  const match = bestMatch(
    entries.filter((e) => e.trust === "trusted" || e.trust === "untrusted"),
    (entry) => pattern.test(entry.content),
  );
  return withMatch("quantity", value, match);
}

function traceAmount(
  amountUsdc: string,
  quantity: number | undefined,
  entries: LedgerEntry[],
  bound: { entry: LedgerEntry; payment: BoundPayment } | null,
  quantityOrigin: FieldOrigin,
): FieldOrigin {
  const value = amountUsdc;
  const amount = baseUnitsOrNull(amountUsdc);
  if (amount === null) return { field: "amountUsdc", value, origin: "unknown" };

  if (bound) {
    const price = baseUnitsOrNull(bound.payment.price);
    const qty = BigInt(quantity ?? 1);
    if (price !== null && (amount === price || amount === price * qty)) {
      const origin = weaker("bound", quantityOrigin.origin);
      return { field: "amountUsdc", value, origin, ledgerEntryId: bound.entry.id };
    }
  }

  const match = bestMatch(
    entries.filter((e) => e.trust === "trusted" || e.trust === "untrusted"),
    (entry) => numbersIn(entry.content).some((n) => n === amount),
  );
  return withMatch("amountUsdc", value, match);
}

/** The most trusted entry satisfying `test`, oldest first among equals. */
function bestMatch(
  entries: LedgerEntry[],
  test: (entry: LedgerEntry) => boolean,
): LedgerEntry | null {
  let best: LedgerEntry | null = null;
  for (const entry of entries) {
    if (!test(entry)) continue;
    if (!best || RANK[entry.trust] > RANK[best.trust]) best = entry;
  }
  return best;
}

function withMatch(field: string, value: string, match: LedgerEntry | null): FieldOrigin {
  return match
    ? { field, value, origin: match.trust, ledgerEntryId: match.id }
    : { field, value, origin: "unknown" };
}

function weaker(a: Origin, b: Origin): Origin {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Every decimal number in `text`, as USDC base units. Skips ones with more than 6 decimals. */
function numbersIn(text: string): bigint[] {
  const found: bigint[] = [];
  for (const [raw] of text.matchAll(/(?<!\d|\d\.)\d+(?:\.\d+)?(?!\d|\.\d)/g)) {
    const units = baseUnitsOrNull(raw);
    if (units !== null) found.push(units);
  }
  return found;
}

function baseUnitsOrNull(amount: string): bigint | null {
  try {
    return BigInt(toBaseUnits(amount));
  } catch {
    return null;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}