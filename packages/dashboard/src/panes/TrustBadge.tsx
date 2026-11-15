import type { TrustLabel } from "@provn/shared";

export function TrustBadge({ trust }: { trust: TrustLabel }) {
  return <span className={`badge badge-${trust}`}>{trust}</span>;
}
