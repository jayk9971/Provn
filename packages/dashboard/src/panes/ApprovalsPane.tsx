import type { ApprovalResult, FieldOrigin, PendingApproval } from "@provn/shared";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { EmptyState } from "./EmptyState.js";
import { Hex } from "./Hex.js";
import { MockNotice } from "./MockNotice.js";
import { TrustBadge } from "./TrustBadge.js";

const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app/tx/";

/** Display names for proposal fields. Unlisted fields show their raw name. */
const FIELD_LABELS: Record<string, string> = {
  recipient: "recipient",
  amountUsdc: "amount",
  quantity: "quantity",
};

/**
 * Pane 3: payments waiting for the user. Each shows why it needs approval and where every
 * payment detail came from, so the user decides with the same information the policy had.
 */
export function ApprovalsPane() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [isMock, setIsMock] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<ApprovalResult | null>(null);

  async function load() {
    const result = await api.listApprovals();
    setPending(result.data);
    setIsMock(result.isMock);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, []);

  async function decide(item: PendingApproval, choice: "approve" | "reject") {
    setBusy(item.proposal.id);
    try {
      const result =
        choice === "approve"
          ? await api.approve(item.proposal.id, item.paymentHash)
          : await api.reject(item.proposal.id);
      setLast(result.data);
    } finally {
      setBusy(null);
      await load();
    }
  }

  return (
    <section className="pane pane-hero" aria-labelledby="approvals-title">
      <div className="pane-head">
        <h2 id="approvals-title">Pending approvals</h2>
        <span
          className={pending.length > 0 ? "count count-active" : "count"}
          aria-label={`${pending.length} waiting`}
        >
          {pending.length}
        </span>
      </div>
      <MockNotice isMock={isMock} />
      <div aria-live="polite">{last && <LastResult result={last} />}</div>
      {pending.length === 0 && (
        <EmptyState title="Nothing waiting" detail="Payments for you to decide appear here." />
      )}
      <ul className="approvals">
        {pending.map((item) => (
          <li key={item.proposal.id} className="approval-card">
            <div className="approval-top">
              <p className="amount">
                {item.proposal.amountUsdc}
                <span className="amount-unit">USDC</span>
                {item.proposal.quantity && item.proposal.quantity > 1 ? (
                  <span className="amount-qty">({item.proposal.quantity} units)</span>
                ) : null}
              </p>
              <span className="status-chip">Needs approval</span>
            </div>
            <dl className="approval-parties">
              <dt>To</dt>
              <dd>
                <Hex value={item.proposal.recipient} />
              </dd>
              {item.proposal.requestedHost && (
                <>
                  <dt>For</dt>
                  <dd>{item.proposal.requestedHost}</dd>
                </>
              )}
            </dl>
            <p className="reason">
              <span className="reason-label">Why you are asked</span>
              {item.reasonForUser}
            </p>
            <p className="origins-label">Where each field came from</p>
            <ul className="origins">
              {item.fieldOrigins.map((origin) => (
                <li key={origin.field} className="origin">
                  <span className="origin-field">{FIELD_LABELS[origin.field] ?? origin.field}</span>
                  <OriginValue origin={origin} />
                  <TrustBadge trust={origin.origin} />
                </li>
              ))}
            </ul>
            <div className="approval-actions">
              <button
                type="button"
                className="btn-approve"
                disabled={busy === item.proposal.id}
                onClick={() => void decide(item, "approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn-reject"
                disabled={busy === item.proposal.id}
                onClick={() => void decide(item, "reject")}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The proposed value of one field, shortened if it is an address. */
function OriginValue({ origin }: { origin: FieldOrigin }) {
  if (origin.value.startsWith("0x")) {
    return (
      <span className="origin-value">
        <Hex value={origin.value} />
      </span>
    );
  }
  return <span className="origin-value">{origin.value}</span>;
}

/** What happened after the last click: sent (with a tx link), rejected, or blocked. */
function LastResult({ result }: { result: ApprovalResult }) {
  const { decision, txHash } = result;
  if (decision.outcome === "allow" && txHash) {
    return (
      <p className="result result-allow">
        <span>Payment sent</span>
        <span className="result-detail">
          <a href={`${ARC_TESTNET_EXPLORER}${txHash}`} target="_blank" rel="noreferrer">
            View transaction <Hex value={txHash} /> on Arcscan
          </a>
        </span>
      </p>
    );
  }
  return (
    <p className="result result-deny">
      <span>Not sent:</span>
      <span className="result-detail">{decision.reasonForUser}</span>
    </p>
  );
}
