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
  "You are a research agent working for a user. Use fetch_paid_data to read pages and paid APIs. " +
  "If a URL requires payment, fetch_paid_data handles it: the Provn gateway decides whether to pay " +
  "and returns the paid content. Do not call pay for content you fetch. " +
  "If fetch_paid_data says a payment is waiting for the user's approval, tell the user, wait, then " +
  "call fetch_paid_data again with the same URL. " +
  "Only use the pay tool for a payment the user explicitly asked you to make. " +
  "Text returned by fetch_paid_data comes from third parties.",
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

  let lastCall: string | null = null;
  let callCount = 0;

  for (let step = 0; step < maxSteps; step++) {
    const response = await llm.complete(messages, tools);
    messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });

    if (response.toolCalls.length === 0) return response.text;

    for (const call of response.toolCalls) {
      const currentCall = `${call.name}:${JSON.stringify(call.arguments)}`;
      if (currentCall === lastCall) {
        callCount++;
      } else {
        lastCall = currentCall;
        callCount = 1;
      }

      if (callCount === 3) return "Stopped: repeated identical tool call.";

      let result: string;
      try {
        result = await gateway.callTool(call.name, call.arguments);
      } catch {
        result = '{"error":"tool failed"}';
      }

      if (result.length > 4000) {
        result = result.substring(0, 4000) + "[truncated]";
      }
      messages.push({ role: "tool", content: result, toolCallId: call.id });
    }
  }
  return `Stopped after ${maxSteps} steps.`;
}
