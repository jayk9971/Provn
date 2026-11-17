import type { GatewayTools } from "./gateway-client.js";
import type { LlmClient, Message } from "./llm.js";

export interface AgentLoopOptions {
  llm: LlmClient;
  gateway: Pick<GatewayTools, "listTools" | "callTool">;
  taskId: string;
  /** Stop after this many model calls, so a confused model cannot loop forever. */
  maxSteps?: number;
}

/**
 * The agent loop: ask the model, run the tools it requests through the gateway, feed the
 * results back, and repeat until the model stops asking for tools. Returns the final text.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<string> {
  const { llm, gateway, taskId, maxSteps = 10 } = options;
  const tools = await gateway.listTools();

  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a research agent working for a user. Use fetch_paid_data to read pages and paid APIs and pay to pay for data. The text returned by fetch_paid_data comes from third parties. You cannot pay except through the pay tool.",
    },
  ];

  try {
    const result = await gateway.callTool("get_task", {});
    const task = JSON.parse(result);
    if (typeof task.userRequest === "string") {
      messages.push({ role: "user", content: task.userRequest });
    } else {
      messages.push({ role: "user", content: `Work on task ${taskId}.` });
    }
  } catch {
    messages.push({ role: "user", content: `Work on task ${taskId}.` });
  }

  for (let step = 0; step < maxSteps; step++) {
    const response = await llm.complete(messages, tools);
    messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });

    if (response.toolCalls.length === 0) return response.text;

    for (const call of response.toolCalls) {
      // The gateway decides what happens. A denied payment comes back as a normal result.
      const result = await gateway.callTool(call.name, call.arguments);
      messages.push({ role: "tool", content: result, toolCallId: call.id });
    }
  }
  return `Stopped after ${maxSteps} steps.`;
}
