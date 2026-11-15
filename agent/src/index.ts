import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("Starting test agent...");
  // Connects to gateway MCP server
  const transport = new StdioClientTransport({
    command: "node",
    args: ["../gateway/src/index.ts"]
  });

  console.log("Agent ready. (Test run complete)");
}

main().catch(console.error);
