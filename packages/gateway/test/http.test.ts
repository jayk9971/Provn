import { beforeEach, describe, expect, it } from "vitest";
import { TASK_ID_HEADER } from "@provn/shared";
import { createApp } from "../src/http/app.js";
import { createServices } from "../src/services.js";
import type { GatewayConfig } from "../src/config.js";

const config: GatewayConfig = {
  port: 0,
  sessionToken: "test-token",
  dbPath: ":memory:",
  policyPath: undefined,
  walletAdapter: "mock",
};

describe("gateway HTTP routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp(createServices(config), config);
  });

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("POST /tasks rejects an invalid body", async () => {
    expect((await post("/tasks", {})).status).toBe(400);
  });

  it("POST /tasks creates a task and GET /tasks/:id/ledger lists the trusted request", async () => {
    const created = await post("/tasks", { userRequest: "Buy one report" });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string };

    const ledger = (await (await app.request(`/tasks/${task.id}/ledger`)).json()) as {
      trust: string;
    }[];
    expect(ledger.map((entry) => entry.trust)).toEqual(["trusted"]);
  });

  it("GET /approvals returns an empty list from the stub", async () => {
    const res = await app.request("/approvals");
    expect(await res.json()).toEqual([]);
  });

  it("POST /approvals/:id/approve validates the body, then returns 501 from the stub", async () => {
    expect((await post("/approvals/p1/approve", {})).status).toBe(400);
    const res = await post("/approvals/p1/approve", { paymentHash: "0x1", approvedBy: "me" });
    expect(res.status).toBe(501);
  });

  it("/mcp rejects requests without the session token", async () => {
    const res = await app.request("/mcp", { method: "POST", headers: { [TASK_ID_HEADER]: "t" } });
    expect(res.status).toBe(401);
  });

  it("/mcp rejects everything when no token is configured", async () => {
    const closed = createApp(createServices(config), { ...config, sessionToken: undefined });
    const res = await closed.request("/mcp", {
      method: "POST",
      headers: { authorization: "Bearer ", [TASK_ID_HEADER]: "t" },
    });
    expect(res.status).toBe(401);
  });
});
