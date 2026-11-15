import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TASK_ID_HEADER } from "@provn/shared";
import type { AgentConfig } from "./config.js";
import type { ToolSpec } from "./llm.js";

/** The agent's whole view of the world: the tools the gateway offers. */
export interface GatewayTools {
  listTools(): Promise<ToolSpec[]>;
  /** Call a gateway tool. Returns the tool's text result. */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

/** Connect to the gateway's MCP endpoint using the session token. */
export async function connectToGateway(config: AgentConfig): Promise<GatewayTools> {
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", config.gatewayUrl), {
    requestInit: {
      headers: {
        authorization: `Bearer ${config.sessionToken}`,
        [TASK_ID_HEADER]: config.taskId,
      },
    },
  });
  const client = new Client({ name: "provn-demo-agent", version: "0.1.0" });
  await client.connect(transport);

  return {
    async listTools() {
      const { tools } = await client.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text?: string }[];
      return content.map((part) => part.text ?? "").join("\n");
    },
    close: () => client.close(),
  };
}
