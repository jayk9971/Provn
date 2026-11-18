import type { ApprovalResult, PendingApproval } from "@provn/shared";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { MockNotice } from "./MockNotice.js";
import { TrustBadge } from "./TrustBadge.js";

const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app/tx/";

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
    <section>
      <h2>Pending approvals</h2>
      <MockNotice isMock={isMock} />
      {last && <LastResult result={last} />}
      {pending.length === 0 && <p>Nothing waiting.</p>}
      <table>
        <tbody>
          {pending.map((item) => (
            <tr key={item.proposal.id}>
              <td>
                <strong>{item.proposal.amountUsdc} USDC</strong>
                {item.proposal.quantity && item.proposal.quantity > 1
                  ? ` (${item.proposal.quantity} units)`
                  : ""}
                <div>to {item.proposal.recipient}</div>
                {item.proposal.requestedHost && <div>for {item.proposal.requestedHost}</div>}
              </td>
              <td>
                <p className="reason">{item.reasonForUser}</p>
                <div className="origins">
                  {item.fieldOrigins.map((origin) => (
                    <span key={origin.field}>
                      {origin.field}: <TrustBadge trust={origin.origin} />
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <button
                  disabled={busy === item.proposal.id}
                  onClick={() => void decide(item, "approve")}
                >
                  Approve
                </button>{" "}
                <button
                  disabled={busy === item.proposal.id}
                  onClick={() => void decide(item, "reject")}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** What happened after the last click: sent (with a tx link), rejected, or blocked. */
function LastResult({ result }: { result: ApprovalResult }) {
  const { decision, txHash } = result;
  if (decision.outcome === "allow" && txHash) {
    return (
      <p className="result-allow">
        Payment sent.{" "}
        <a href={`${ARC_TESTNET_EXPLORER}${txHash}`} target="_blank" rel="noreferrer">
          View transaction
        </a>
      </p>
    );
  }
  return <p className="result-deny">Not sent: {decision.reasonForUser}</p>;
}
