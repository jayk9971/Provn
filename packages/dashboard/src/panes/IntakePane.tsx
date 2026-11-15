import type { Task } from "@provn/shared";
import { useState } from "react";
import { api } from "../api.js";
import { MockNotice } from "./MockNotice.js";

/** Pane 1: type a request, create a task, and see the mandate Provn extracted from it. */
export function IntakePane({
  task,
  onTask,
}: {
  task: Task | undefined;
  onTask: (task: Task) => void;
}) {
  const [request, setRequest] = useState("Buy one EV battery market report");
  const [isMock, setIsMock] = useState(false);

  async function submit() {
    const result = await api.createTask(request);
    setIsMock(result.isMock);
    onTask(result.data);
  }

  return (
    <section>
      <h2>Task intake and mandate</h2>
      <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} />
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
