import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

/** SHA-256 hex digest. Used for `LedgerEntry.contentHash`. */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Prefixed random ID, e.g. newId("task") -> "task_3f2a...". */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Compare secrets without leaking length or content through timing. */
export function secretsMatch(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Normalize a vendor for comparison: an address is lowercased; a host is lowercased with any
 * scheme, port, path, query or trailing dot removed. So "https://Paid-API.example:3002/report"
 * and "paid-api.example" compare equal.
 */
export function normalizeVendor(vendor: string): string {
  const trimmed = vendor.trim().toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(trimmed)) return trimmed;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  return (withoutScheme.split(/[/:?#]/)[0] ?? "").replace(/\.$/, "");
}
