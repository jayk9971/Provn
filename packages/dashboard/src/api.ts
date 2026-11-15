import type { Approval, LedgerEntry, PendingApproval, Task } from "@provn/shared";
import { MOCK_APPROVALS, MOCK_LEDGER, MOCK_TASK } from "./mock.js";

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
  createTask: (userRequest: string) =>
    call<Task>("/tasks", json({ userRequest }), { ...MOCK_TASK, userRequest }),
  getLedger: (taskId: string) =>
    call<LedgerEntry[]>(`/tasks/${taskId}/ledger`, undefined, MOCK_LEDGER),
  listApprovals: () => call<PendingApproval[]>("/approvals", undefined, MOCK_APPROVALS),
  approve: (proposalId: string, paymentHash: string) =>
    call<Approval>(
      `/approvals/${proposalId}/approve`,
      json({ paymentHash, approvedBy: "dashboard-user" }),
      // TODO: the mock approval is only a placeholder; the real one comes from the gateway.
      {
        proposalId,
        paymentHash,
        approvedBy: "dashboard-user",
        expiresAt: new Date().toISOString(),
      },
    ),
};
