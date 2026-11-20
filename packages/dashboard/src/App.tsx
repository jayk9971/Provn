import type { FieldOrigin, Task } from "@provn/shared";
import { useState } from "react";
import { ApprovalsPane } from "./panes/ApprovalsPane.js";
import { BudgetPane } from "./panes/BudgetPane.js";
import { ChainEventsPane } from "./panes/ChainEventsPane.js";
import { IntakePane } from "./panes/IntakePane.js";
import { LedgerPane } from "./panes/LedgerPane.js";
import { TrustBadge } from "./panes/TrustBadge.js";

const LEGEND: FieldOrigin["origin"][] = ["trusted", "bound", "untrusted", "derived", "unknown"];

export function App() {
  const [task, setTask] = useState<Task | undefined>();

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <h1>
            <span className="brand-mark" aria-hidden="true" />
            Provn
          </h1>
          <p className="tagline">
            Spending limits check how much an agent pays.{" "}
            <strong>Provn checks who told it to pay.</strong>
          </p>
        </div>
        <ul className="legend" aria-label="Trust labels">
          <li className="legend-title" aria-hidden="true">
            Trust
          </li>
          {LEGEND.map((label) => (
            <li key={label}>
              <TrustBadge trust={label} />
            </li>
          ))}
        </ul>
      </header>
      <main>
        <div className="column column-left">
          <IntakePane task={task} onTask={setTask} />
          <BudgetPane />
        </div>
        <div className="column column-center">
          <ApprovalsPane />
        </div>
        <div className="column column-right">
          <LedgerPane taskId={task?.id} />
          <ChainEventsPane />
        </div>
      </main>
    </>
  );
}
