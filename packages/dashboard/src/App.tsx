import type { Task } from "@provn/shared";
import { useState } from "react";
import { ApprovalsPane } from "./panes/ApprovalsPane.js";
import { BudgetPane } from "./panes/BudgetPane.js";
import { IntakePane } from "./panes/IntakePane.js";
import { LedgerPane } from "./panes/LedgerPane.js";

export function App() {
  const [task, setTask] = useState<Task | undefined>();

  return (
    <>
      <header>
        <h1>Provn</h1>
      </header>
      <main>
        <IntakePane task={task} onTask={setTask} />
        <LedgerPane taskId={task?.id} />
        <ApprovalsPane />
        <BudgetPane />
      </main>
    </>
  );
}
