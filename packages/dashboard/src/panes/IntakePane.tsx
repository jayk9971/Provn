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
    <section>
      <h2>Task intake and mandate</h2>
      <label>
        Request
        <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} />
      </label>
      <label>
        Budget (USDC)
        <input
          value={budgetUsdc}
          placeholder="10"
          onChange={(e) => setBudgetUsdc(e.target.value)}
        />
      </label>
      <label>
        Allowed vendors
        <input
          value={vendors}
          placeholder="paid-api.example, 0x…"
          onChange={(e) => setVendors(e.target.value)}
        />
      </label>
      <label>
        Expires in minutes
        <input
          type="number"
          min={1}
          max={1440}
          value={expiresInMinutes}
          placeholder="60"
          onChange={(e) => setExpiresInMinutes(e.target.value)}
        />
      </label>
      <button onClick={submit}>Create task</button>
      <MockNotice isMock={isMock} />
      {task && (
        <dl>
          <dt>Task</dt>
          <dd>{task.id}</dd>
          <dt>Purpose</dt>
          <dd>{task.mandate.purpose}</dd>
          <dt>Max total</dt>
          <dd>{task.mandate.maxTotalUsdc} USDC</dd>
          <dt>Allowed vendors</dt>
          <dd>{task.mandate.allowedVendors.join(", ") || "none"}</dd>
          <dt>Expires</dt>
          <dd>{task.mandate.expiresAt}</dd>
        </dl>
      )}
    </section>
  );
}
