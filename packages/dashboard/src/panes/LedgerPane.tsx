import type { LedgerEntry } from "@provn/shared";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { EmptyState } from "./EmptyState.js";
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
    <section className="pane pane-ledger" aria-labelledby="ledger-title">
      <div className="pane-head">
        <h2 id="ledger-title">Live ledger</h2>
        {taskId && <span className="count">{entries.length}</span>}
      </div>
      <MockNotice isMock={isMock} />
      {!taskId && <EmptyState title="No task yet" detail="Create a task to see its ledger." />}
      {taskId && entries.length === 0 && (
        <EmptyState
          title="Nothing recorded yet"
          detail="Entries appear as the agent fetches content."
        />
      )}
      {/* Keyed by entry id, so only newly added entries play the enter animation. */}
      <ol className="ledger">
        {entries.map((entry) => (
          <li key={entry.id} className={`ledger-entry ledger-entry-${entry.trust}`}>
            <div>
              <TrustBadge trust={entry.trust} />
            </div>
            <div>
              <div className="ledger-meta">
                <span className="mono">{entry.source}</span>
                <span>{entry.origin ?? "-"}</span>
              </div>
              <p className="ledger-content" title={entry.content}>
                {entry.content}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
