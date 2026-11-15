import type { LedgerEntry } from "@provn/shared";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { MockNotice } from "./MockNotice.js";
import { TrustBadge } from "./TrustBadge.js";

/** Pane 2: the live provenance ledger for the current task, with a trust badge per entry. */
export function LedgerPane({ taskId }: { taskId: string | undefined }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const load = async () => {
      const result = await api.getLedger(taskId);
      if (!cancelled) {
        setEntries(result.data);
        setIsMock(result.isMock);
      }
    };
    void load();
    const timer = setInterval(load, 2000); // TODO: replace polling with server push.
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId]);

  return (
    <section>
      <h2>Live ledger</h2>
      <MockNotice isMock={isMock} />
      {!taskId && <p>Create a task to see its ledger.</p>}
      <table>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <TrustBadge trust={entry.trust} />
              </td>
              <td>{entry.source}</td>
              <td>{entry.origin ?? "-"}</td>
              <td>{entry.content}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
