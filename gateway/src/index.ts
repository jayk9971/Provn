import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { db } from "./db.ts";
import { approvePayment, rejectPayment } from "./approvals/index.ts";
import { readSpentToday } from "./vault/index.ts";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/approvals/pending", (c) => {
  const pending = db.prepare(`SELECT * FROM approvals WHERE status = 'pending'`).all();
  return c.json(pending);
});

app.post("/approvals/:id/approve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  try {
    const result = await approvePayment(id, body.paymentHash);
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

app.post("/approvals/:id/reject", (c) => {
  const id = c.req.param("id");
  try {
    const result = rejectPayment(id);
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

app.get("/audit", (c) => {
  const logs = db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 50`).all();
  return c.json(logs);
});

app.get("/vault/status", async (c) => {
  const spent = await readSpentToday();
  return c.json({ spentToday: spent.toString() });
});

const port = Number(process.env.PORT || 3001);
console.log(`Gateway running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
