import { serve } from "@hono/node-server";
import { createPaidApi } from "./app.js";

const port = Number(process.env.PAID_API_PORT ?? 3002);

serve({ fetch: createPaidApi().fetch, port }, ({ port }) => {
  console.log(`Paid API listening on http://localhost:${port}`);
});
