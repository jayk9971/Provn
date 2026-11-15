import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./http/app.js";
import { createServices } from "./services.js";

const config = loadConfig();
if (!config.sessionToken) {
  console.warn("GATEWAY_SESSION_TOKEN is not set: /mcp will reject every request.");
}

const services = createServices(config);
const app = createApp(services, config);

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Provn gateway listening on http://localhost:${port}`);
});
