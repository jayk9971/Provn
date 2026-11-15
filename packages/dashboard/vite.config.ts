import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Read ports from the repo-root .env so every package agrees on them.
  const env = loadEnv(mode, "../..", "");
  const gatewayUrl = env.GATEWAY_URL ?? `http://localhost:${env.GATEWAY_PORT ?? 3001}`;

  return {
    plugins: [react()],
    server: {
      port: Number(env.DASHBOARD_PORT ?? 3003),
      // The dashboard calls /api/*; Vite forwards to the gateway, so there is no CORS to set up.
      proxy: {
        "/api": { target: gatewayUrl, rewrite: (path) => path.replace(/^\/api/, "") },
      },
    },
  };
});
