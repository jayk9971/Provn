import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { TASK_ID_HEADER } from "@provn/shared";
import { Hono, type Context } from "hono";
import type { ZodType } from "zod";
import type { GatewayConfig } from "../config.js";
import { createMcpServer } from "../mcp/server.js";
import type { Services } from "../services.js";
import { secretsMatch } from "../util.js";
import { ApproveBodySchema, CreateTaskBodySchema } from "../validation.js";
import { NotImplementedError } from "../errors.js";

/** Parse a JSON request body with zod. Returns a 400 Response if it is invalid. */
async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T | Response> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
  }
  return parsed.data;
}

export function createApp(services: Services, config: GatewayConfig): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof NotImplementedError) return c.json({ error: error.message }, 501);
    console.error("unhandled error", error);
    return c.json({ error: "Internal error" }, 500);
  });

  // ---- MCP endpoint (for the agent) ----
  app.all("/mcp", async (c) => {
    // Fail closed: with no configured token, nobody gets in.
    const expected = config.sessionToken;
    const presented = c.req.header("authorization")?.replace(/^Bearer /i, "") ?? "";
    if (!expected || !secretsMatch(presented, expected)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    // TODO: bind the session token to one task and agent on the gateway side. Today the agent
    // names its own task via a header, which is fine for a demo but not for production.
    const taskId = c.req.header(TASK_ID_HEADER);
    if (!taskId) return c.json({ error: `Missing ${TASK_ID_HEADER} header` }, 400);

    // Stateless: a fresh server and transport per request.
    const server = createMcpServer({ taskId, agentId: "demo-agent" }, services);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // ---- Routes for the dashboard ----
  // TODO: authenticate these routes. They are open for the local demo only.

  app.post("/tasks", async (c) => {
    const body = await parseBody(c, CreateTaskBodySchema);
    if (body instanceof Response) return body;
    const task = await services.intake.createTask(body.userRequest);
    return c.json(task, 201);
  });

  app.get("/tasks/:id/ledger", (c) => {
    return c.json(services.ledger.listByTask(c.req.param("id")));
  });

  app.get("/approvals", (c) => c.json(services.approvals.listPending()));

  app.post("/approvals/:id/approve", async (c) => {
    const body = await parseBody(c, ApproveBodySchema);
    if (body instanceof Response) return body;
    // TODO: after approving, execute the payment through the wallet adapter.
    const approval = services.approvals.approve(
      c.req.param("id"),
      body.paymentHash,
      body.approvedBy,
    );
    return c.json(approval);
  });

  return app;
}
