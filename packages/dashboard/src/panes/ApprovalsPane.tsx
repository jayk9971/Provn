import type { PendingApproval } from "@provn/shared";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { MockNotice } from "./MockNotice.js";

/** Pane 3: payments waiting for the user, each with an Approve button. */
export function ApprovalsPane() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [isMock, setIsMock] = useState(false);

  async function load() {
    const result = await api.listApprovals();
    setPending(result.data);
    setIsMock(result.isMock);
  }

  useEffect(() => {
    void load();
  }, []);

  async function approve(item: PendingApproval) {
    await api.approve(item.proposal.id, item.paymentHash);
    await load();
  }

  return (
    <section>
      <h2>Pending approvals</h2>
      <MockNotice isMock={isMock} />
      {pending.length === 0 && <p>Nothing waiting.</p>}
      <table>
        <tbody>
          {pending.map((item) => (
            <tr key={item.proposal.id}>
              <td>{item.proposal.amountUsdc} USDC</td>
              <td>to {item.proposal.recipient}</td>
              <td>
                <button onClick={() => approve(item)}>Approve</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
