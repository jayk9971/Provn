import type { FieldOrigin } from "@provn/shared";

/** What each label means, shown on hover. */
export const TRUST_DESCRIPTIONS: Record<FieldOrigin["origin"], string> = {
  trusted: "Typed by the user",
  bound: "Payee or price from the vendor's own 402 response on the requested host",
  untrusted: "Content fetched from outside. Never a source of payment details",
  derived: "Computed by the agent from other entries",
  unknown: "Could not be traced to any input",
};

/** A trust label, or "unknown" for a payment field that couldn't be traced to any input. */
export function TrustBadge({ trust }: { trust: FieldOrigin["origin"] }) {
  return (
    <span className={`badge badge-${trust}`} title={TRUST_DESCRIPTIONS[trust]}>
      {trust}
    </span>
  );
}
