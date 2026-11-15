import React, { useState, useEffect } from "react";

interface AuditEntry {
  id: number;
  proposal_id: string;
  decision: string;
  rule: string;
  reason: string;
  inputs: string;
  provenance: string;
  tx_hash?: string;
  timestamp: string;
}

interface Approval {
  approval_id: string;
  proposal_id: string;
  payment_hash: string;
  recipient: string;
  amount: string;
  expires_at: string;
}

export default function App() {
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [vaultSpent, setVaultSpent] = useState<string>("0");
  const [mandate, setMandate] = useState({
    purpose: "Automated agent research and data acquisition",
    maxTotal: "50",
    vendors: ["0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"]
  });

  const fetchData = async () => {
    try {
      const auditRes = await fetch("/api/audit");
      if (auditRes.ok) setAuditLogs(await auditRes.json());

      const approvalsRes = await fetch("/api/approvals/pending");
      if (approvalsRes.ok) setPendingApprovals(await approvalsRes.json());

      const vaultRes = await fetch("/api/vault/status");
      if (vaultRes.ok) {
        const data = await vaultRes.json();
        setVaultSpent(data.spentToday);
      }
    } catch (e) {
      console.error("Failed to fetch dashboard state", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (approval: Approval) => {
    try {
      const res = await fetch(`/api/approvals/${approval.approval_id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentHash: approval.payment_hash })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Payment approved & executed! Tx: ${data.txHash}`);
        fetchData();
      } else {
        alert(`Approval failed: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleReject = async (approvalId: string) => {
    try {
      await fetch(`/api/approvals/${approvalId}/reject`, { method: "POST" });
      fetchData();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const spentDecimal = (Number(vaultSpent) / 1_000_000).toFixed(2);
  const dailyBudgetDecimal = "100.00";

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <header style={{ marginBottom: "32px", borderBottom: "1px solid #334155", paddingBottom: "16px" }}>
        <h1 style={{ margin: 0, fontSize: "28px", color: "#38bdf8" }}>Agent Spend Firewall Dashboard</h1>
        <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>Real-time agent governance, provenance ledger, and vault monitoring</p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Pane 1: Mandate & Limits */}
        <div style={{ background: "#1e293b", padding: "20px", borderRadius: "12px", border: "1px solid #334155" }}>
          <h2 style={{ marginTop: 0, color: "#f1f5f9", fontSize: "18px" }}>1. Active Mandate & Vault Budget</h2>
          <div style={{ marginBottom: "12px" }}>
            <strong>Purpose:</strong> <span style={{ color: "#cbd5e1" }}>{mandate.purpose}</span>
          </div>
          <div style={{ marginBottom: "12px" }}>
            <strong>Max Total Mandate:</strong> <span style={{ color: "#cbd5e1" }}>${mandate.maxTotal} USDC</span>
          </div>
          <div style={{ marginBottom: "12px" }}>
            <strong>Allowed Vendors:</strong>
            <ul style={{ margin: "4px 0", paddingLeft: "20px", color: "#94a3b8", wordBreak: "break-all" }}>
              {mandate.vendors.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          </div>
          <div style={{ marginTop: "16px", background: "#0f172a", padding: "12px", borderRadius: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span>Spent Today:</span>
              <strong style={{ color: "#38bdf8" }}>${spentDecimal} / ${dailyBudgetDecimal} USDC</strong>
            </div>
            <div style={{ width: "100%", background: "#334155", height: "8px", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, (Number(spentDecimal) / 100) * 100)}%`, background: "#38bdf8", height: "100%" }} />
            </div>
          </div>
        </div>

        {/* Pane 3: Pending Approvals */}
        <div style={{ background: "#1e293b", padding: "20px", borderRadius: "12px", border: "1px solid #334155" }}>
          <h2 style={{ marginTop: 0, color: "#f1f5f9", fontSize: "18px" }}>3. Pending Approvals ({pendingApprovals.length})</h2>
          {pendingApprovals.length === 0 ? (
            <p style={{ color: "#64748b" }}>No pending payment approvals requiring attention.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {pendingApprovals.map((app) => (
                <div key={app.approval_id} style={{ background: "#0f172a", padding: "12px", borderRadius: "8px", border: "1px solid #475569" }}>
                  <div style={{ fontSize: "14px", marginBottom: "4px" }}><strong>Recipient:</strong> <span style={{ wordBreak: "break-all" }}>{app.recipient}</span></div>
                  <div style={{ fontSize: "14px", marginBottom: "8px" }}><strong>Amount:</strong> ${(Number(app.amount) / 1_000_000).toFixed(2)} USDC</div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => handleApprove(app)} style={{ background: "#22c55e", color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>Approve & Send</button>
                    <button onClick={() => handleReject(app.approval_id)} style={{ background: "#ef4444", color: "white", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pane 2: Live Provenance Ledger & Audit Log */}
      <div style={{ marginTop: "24px", background: "#1e293b", padding: "20px", borderRadius: "12px", border: "1px solid #334155" }}>
        <h2 style={{ marginTop: 0, color: "#f1f5f9", fontSize: "18px" }}>2. Live Provenance Ledger & Decision Audit Log</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155", color: "#94a3b8" }}>
                <th style={{ padding: "10px" }}>Time</th>
                <th style={{ padding: "10px" }}>Proposal ID</th>
                <th style={{ padding: "10px" }}>Decision</th>
                <th style={{ padding: "10px" }}>Rule</th>
                <th style={{ padding: "10px" }}>Reason</th>
                <th style={{ padding: "10px" }}>Tx Hash / Explorer</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "16px", textAlign: "center", color: "#64748b" }}>No audit log entries yet.</td>
                </tr>
              ) : (
                auditLogs.map((log) => {
                  const decisionColor = log.decision === "ALLOW" ? "#22c55e" : log.decision === "REQUIRE_APPROVAL" ? "#eab308" : "#ef4444";
                  return (
                    <tr key={log.id} style={{ borderBottom: "1px solid #334155" }}>
                      <td style={{ padding: "10px", color: "#94a3b8", whiteSpace: "nowrap" }}>{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td style={{ padding: "10px", fontFamily: "monospace", fontSize: "12px" }}>{log.proposal_id.substring(0, 10)}...</td>
                      <td style={{ padding: "10px" }}><span style={{ background: decisionColor, color: "black", padding: "2px 8px", borderRadius: "4px", fontWeight: "bold", fontSize: "12px" }}>{log.decision}</span></td>
                      <td style={{ padding: "10px", fontFamily: "monospace" }}>{log.rule}</td>
                      <td style={{ padding: "10px", color: "#cbd5e1" }}>{log.reason}</td>
                      <td style={{ padding: "10px", fontFamily: "monospace", fontSize: "12px" }}>
                        {log.tx_hash ? (
                          <a href={`https://testnet.arcscan.io/tx/${log.tx_hash}`} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>
                            {log.tx_hash.substring(0, 10)}...
                          </a>
                        ) : (
                          <span style={{ color: "#64748b" }}>N/A</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
