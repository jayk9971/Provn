import type { Task } from "@provn/shared";
import { useState } from "react";
import { api } from "../api.js";
import { MockNotice } from "./MockNotice.js";

/** Pane 1: the user writes a request and the mandate limits the agent may spend under. */
export function IntakePane({
  task,
  onTask,
}: {
  task: Task | undefined;
  onTask: (task: Task) => void;
}) {
  const [request, setRequest] = useState("Buy one EV battery market report");
  const [budgetUsdc, setBudgetUsdc] = useState("");
  const [vendors, setVendors] = useState("");
  const [expiresInMinutes, setExpiresInMinutes] = useState("");
  const [isMock, setIsMock] = useState(false);

  async function submit() {
    const allowedVendors = vendors
      .split(",")
      .map((vendor) => vendor.trim())
      .filter((vendor) => vendor.length > 0);
    const minutes = expiresInMinutes.trim();
    const result = await api.createTask({
      userRequest: request,
      ...(budgetUsdc.trim() ? { budgetUsdc: budgetUsdc.trim() } : {}),
      ...(allowedVendors.length > 0 ? { allowedVendors } : {}),
      ...(minutes ? { expiresInMinutes: Number(minutes) } : {}),
    });
    setIsMock(result.isMock);
    onTask(result.data);
  }

  return (
    <section className="pane pane-intake" aria-labelledby="intake-title">
      <div className="pane-head">
        <h2 id="intake-title">Task and mandate</h2>
      </div>
      <p className="pane-sub">What you type here is the only trusted input.</p>
      <label className="field">
        Request
        <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field">
          Budget <span className="field-hint">(USDC)</span>
          <input
            value={budgetUsdc}
            placeholder="10"
            onChange={(e) => setBudgetUsdc(e.target.value)}
          />
        </label>
        <label className="field">
          Expires in <span className="field-hint">(minutes)</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={expiresInMinutes}
            placeholder="60"
            onChange={(e) => setExpiresInMinutes(e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        Allowed vendors <span className="field-hint">(comma separated)</span>
        <input
          value={vendors}
          placeholder="paid-api.example, 0x…"
          onChange={(e) => setVendors(e.target.value)}
        />
      </label>
      <button type="button" className="btn-primary" onClick={submit}>
        Create task
      </button>
      <MockNotice isMock={isMock} />
      {task && (
        <dl className="facts">
          <dt>Task</dt>
          <dd className="mono">{task.id}</dd>
          <dt>Purpose</dt>
          <dd>{task.mandate.purpose}</dd>
          <dt>Max total</dt>
          <dd>{task.mandate.maxTotalUsdc} USDC</dd>
          <dt>Allowed vendors</dt>
          <dd>{task.mandate.allowedVendors.join(", ") || "none"}</dd>
          <dt>Expires</dt>
          <dd title={task.mandate.expiresAt}>{formatTime(task.mandate.expiresAt)}</dd>
        </dl>
      )}
    </section>
  );
}

/** Local date and time for an ISO timestamp, or the raw value if it can't be parsed. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
