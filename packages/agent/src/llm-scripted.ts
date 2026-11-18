import type { LlmClient, LlmResponse, Message, ToolSpec } from "./llm.js";
import { readFileSync } from "node:fs";

export class ScriptedLlmClient implements LlmClient {
  private steps: { text: string; toolCalls: { name: string; arguments: Record<string, unknown> }[] }[];
  private currentStep = 0;

  constructor(scriptPath: string) {
    const data = JSON.parse(readFileSync(scriptPath, "utf-8"));
    this.steps = data;
  }

  async complete(_messages: Message[], _tools: ToolSpec[]): Promise<LlmResponse> {
    const step = this.steps[this.currentStep++];
    if (!step) {
      return { text: "Script finished.", toolCalls: [] };
    }
    return {
      text: step.text,
      toolCalls: step.toolCalls.map((call, index) => ({
        id: `script_${this.currentStep}_${index}`,
        name: call.name,
        arguments: call.arguments,
      })),
    };
  }
}
