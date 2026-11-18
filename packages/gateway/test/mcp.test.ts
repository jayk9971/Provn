import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import type { GatewayConfig } from "../src/config.js";
import { TASK_ID_HEADER } from "@provn/shared";
import { createApp } from "../src/http/app.js";
import { createServices } from "../src/services.js";

const config: GatewayConfig = {
  port: 0,
  sessionToken: "test-token",
  dbPath: ":memory:",
  policyPath: undefined,
  walletAdapter: "mock",
};

/** Connect a real MCP client to the gateway app, in-process (no network). */
async function connect() {
  const services = createServices(config);
  const app = createApp(services, config);
  const task = await services.intake.createTask("Buy one report");

  const transport = new StreamableHTTPClientTransport(new URL("http://gateway.test/mcp"), {
    requestInit: {
      headers: { authorization: "Bearer test-token", [TASK_ID_HEADER]: task.id },
    },
    fetch: async (input, init) =>
      app.request(input instanceof URL ? input.toString() : input, init),
  });
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(transport);
  return { client, services, taskId: task.id };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]?.text ?? "null");
}

describe("gateway MCP server", () => {
  it("exposes fetch_paid_data and pay", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["fetch_paid_data", "pay"]);
  });

  it("fetch_paid_data writes an untrusted ledger entry", async () => {
    const { client, services, taskId } = await connect();
    await client.callTool({
      name: "fetch_paid_data",
      arguments: { url: "https://vendor.example/report" },
    });
    const trusts = services.ledger.listByTask(taskId).map((entry) => entry.trust);
    expect(trusts).toEqual(["trusted", "untrusted"]);
  });

  it("pay to an untraceable recipient is denied, and the agent only sees a short reason", async () => {    const { client } = await connect();
    const result = await client.callTool({
      name: "pay",
      arguments: { recipient: "0x" + "ab".repeat(20), amount: "1.00", memo: "x" },
    });
    expect(textOf(result)).toMatchObject({ outcome: "deny", reason: "Payment denied." });
  });

  it("pay with garbage input is denied, not a protocol error", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "pay",
      arguments: { recipient: "x", amount: "-1" },
    });
    expect(textOf(result)).toMatchObject({ outcome: "deny" });
  });
});
