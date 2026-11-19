import type { ApprovalResult, LedgerEntry, PendingApproval, Task } from "@provn/shared";
import { MOCK_APPROVALS, MOCK_LEDGER, MOCK_STATUS, MOCK_TASK } from "./mock.js";

/** The vault's state, from GET /status (mirrors VaultStatus in the gateway). */
export interface VaultStatus {
  balanceUsdc: string;
  perTxMaxUsdc: string;
  dailyBudgetUsdc: string;
  spentTodayUsdc: string;
  remainingTodayUsdc: string;
  paused: boolean;
}

/** A USDC transfer out of the vault seen by QuickNode, from GET /chain-events. */
export interface ChainEvent {
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  amountBaseUnits: string;
  status: "matched" | "unreconciled";
  proposalId: string | null;
  detail: string;
  pauseTxHash: string | null;
  createdAt: string;
}

/** `isMock` is true when the gateway could not answer and placeholder data was used instead. */
export interface ApiResult<T> {
  data: T;
  isMock: boolean;
}

/** Call the gateway through the Vite proxy. Falls back to mock data if the call fails. */
async function call<T>(
  path: string,
  init: RequestInit | undefined,
  mock: T,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, init);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return { data: (await res.json()) as T, isMock: false };
  } catch {
    return { data: mock, isMock: true };
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  createTask: (body: {
    userRequest: string;
    budgetUsdc?: string;
    allowedVendors?: string[];
    expiresInMinutes?: number;
  }) => call<Task>("/tasks", json(body), { ...MOCK_TASK, userRequest: body.userRequest }),
  getLedger: (taskId: string) =>
    call<LedgerEntry[]>(`/tasks/${taskId}/ledger`, undefined, MOCK_LEDGER),
  listApprovals: () => call<PendingApproval[]>("/approvals", undefined, MOCK_APPROVALS),
  getStatus: () => call<VaultStatus>("/status", undefined, MOCK_STATUS),
  listChainEvents: () => call<ChainEvent[]>("/chain-events", undefined, []),
  approve: (proposalId: string, paymentHash: string) =>
    call<ApprovalResult>(
      `/approvals/${proposalId}/approve`,
      json({ paymentHash, approvedBy: "dashboard-user" }),
      mockResult(proposalId, "deny", "Gateway unreachable: nothing was paid."),
    ),
  reject: (proposalId: string) =>
    call<ApprovalResult>(
      `/approvals/${proposalId}/reject`,
      json({ rejectedBy: "dashboard-user" }),
      mockResult(proposalId, "deny", "Gateway unreachable: nothing was rejected."),
    ),
};

/** Placeholder result when the gateway can't be reached. Never claims a payment was sent. */
function mockResult(proposalId: string, outcome: "deny", reasonForUser: string): ApprovalResult {
  return {
    approval: null,
    decision: {
      proposalId,
      outcome,
      ruleId: "mock",
      reasonForUser,
      reasonForAgent: "Payment denied.",
      fieldOrigins: [],
    },
    txHash: null,
  };
}
