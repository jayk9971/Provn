import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { gunzipSync } from "node:zlib";
import { ARC_USDC_ADDRESS, TASK_ID_HEADER } from "@provn/shared";
import { Hono, type Context } from "hono";
import type { ZodType } from "zod";
import type { GatewayConfig } from "../config.js";
import { createMcpServer } from "../mcp/server.js";
import type { Services } from "../services.js";
import { secretsMatch } from "../util.js";
import { ApproveBodySchema, CreateTaskBodySchema, RejectBodySchema } from "../validation.js";
import { ApprovalError, type ApprovalErrorCode } from "../approvals/index.js";
import { NotImplementedError } from "../errors.js";
import { extractVaultTransfers, verifyQuickNodeSignature } from "../reconcile/index.js";

/** HTTP status for each reason an approval can be refused. */
const APPROVAL_ERROR_STATUS: Record<ApprovalErrorCode, 404 | 409 | 410> = {
  not_found: 404,
  hash_mismatch: 409,
  already_decided: 409,
  expired: 410,
};

/** Parse a JSON request body with zod. Returns a 400 Response if it is invalid. */
async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T | Response> {
  const json: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
  }
  return parsed.data;
}

/** QuickNode nonces seen recently, so a captured delivery can't be replayed inside the window. */
const SEEN_NONCES_MAX = 10_000;

export function createApp(services: Services, config: GatewayConfig): Hono {
  const app = new Hono();
  const seenNonces = new Set<string>();

  app.onError((error, c) => {
    if (error instanceof NotImplementedError) return c.json({ error: error.message }, 501);
    if (error instanceof ApprovalError) {
      return c.json({ error: error.message, code: error.code }, APPROVAL_ERROR_STATUS[error.code]);
    }
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

  // ---- QuickNode reconciliation webhook ----
  // Authenticated by QuickNode's HMAC signature, not the agent's token. Fails closed: with no
  // configured secret or vault address, every delivery is refused.
  app.post("/chain-events", async (c) => {
    const secret = config.quicknodeSecret;
    const vault = config.vaultAddress;
    if (!secret || !vault) return c.json({ error: "Reconciliation is not configured" }, 503);

    let raw = Buffer.from(await c.req.arrayBuffer());
    // QuickNode may gzip the body. The signature covers the decompressed text.
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      try {
        raw = gunzipSync(raw);
      } catch {
        return c.json({ error: "Invalid gzip body" }, 400);
      }
    }
    const body = raw.toString("utf8");
    const headers = {
      nonce: c.req.header("x-qn-nonce"),
      timestamp: c.req.header("x-qn-timestamp"),
      signature: c.req.header("x-qn-signature"),
    };
    if (!verifyQuickNodeSignature(body, headers, secret)) {
      return c.json({ error: "Invalid signature" }, 401);
    }
    if (seenNonces.has(headers.nonce!)) return c.json({ error: "Replayed delivery" }, 409);
    if (seenNonces.size >= SEEN_NONCES_MAX) seenNonces.clear();
    seenNonces.add(headers.nonce!);

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const transfers = extractVaultTransfers(payload, config.usdcAddress ?? ARC_USDC_ADDRESS, vault);
    return c.json({ transfers: transfers.length, ...services.reconciler.ingest(transfers) });
  });

  // ---- Routes for the dashboard ----

  /** The vault's limits, today's spend and whether it is paused. */
  app.get("/status", async (c) => c.json(await services.wallet.getStatus()));

  /** Recent reconciled transfers, newest first. */
  app.get("/chain-events", (c) => c.json(services.chainEvents.list()));

  // TODO: authenticate these routes. They are open for the local demo only.

  app.post("/tasks", async (c) => {
    const body = await parseBody(c, CreateTaskBodySchema);
    if (body instanceof Response) return body;
    const { userRequest, ...form } = body;
    const task = await services.intake.createTask(userRequest, form);
    return c.json(task, 201);
  });

  app.get("/tasks/:id/ledger", (c) => {
    return c.json(services.ledger.listByTask(c.req.param("id")));
  });

  app.get("/approvals", (c) => c.json(services.approvals.listPending()));

  // Approve: consumes the approval, re-checks the policy, then pays. The response says what
  // happened: decision.outcome "allow" with a txHash means the payment was sent.
  app.post("/approvals/:id/approve", async (c) => {
    const body = await parseBody(c, ApproveBodySchema);
    if (body instanceof Response) return body;
    const result = await services.pipeline.approvePending(
      c.req.param("id"),
      body.paymentHash,
      body.approvedBy,
    );
    return c.json(result);
  });

  app.post("/approvals/:id/reject", async (c) => {
    const body = await parseBody(c, RejectBodySchema);
    if (body instanceof Response) return body;
    return c.json(services.pipeline.rejectPending(c.req.param("id"), body.rejectedBy));
  });

  return app;
}
