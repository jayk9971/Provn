import type { FieldOrigin } from "@provn/shared";

/** A trust label, or "unknown" for a payment field that couldn't be traced to any input. */
export function TrustBadge({ trust }: { trust: FieldOrigin["origin"] }) {
  return <span className={`badge badge-${trust}`}>{trust}</span>;
}
