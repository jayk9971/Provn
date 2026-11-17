import type { AgentConfig } from "./config.js";
import { OpenAiCompatLlmClient } from "./llm-openai-compat.js";

/** A tool the model may call. Mirrors an MCP tool listing. */
export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  /** For role "tool": which tool call this message answers. */
  toolCallId?: string;
  /** For role "assistant": tool calls the model asked for. */
  toolCalls?: ToolCall[];
}

export interface LlmResponse {
  text: string;
  /** Empty when the model is done. */
  toolCalls: ToolCall[];
}

/** One LLM provider with tool calling. */
export interface LlmClient {
  complete(messages: Message[], tools: ToolSpec[]): Promise<LlmResponse>;
}

/** Placeholder client: makes no network call and asks for no tools. */
export class StubLlmClient implements LlmClient {
  constructor(private readonly provider: string) {}

  async complete(_messages: Message[], _tools: ToolSpec[]): Promise<LlmResponse> {
    return { text: `TODO: ${this.provider} LLM call is not implemented.`, toolCalls: [] };
  }
}

/** Pick the LLM client named by LLM_PROVIDER. */
export function createLlmClient(config: AgentConfig): LlmClient {
  switch (config.llmProvider) {
    case "openai":
    case "groq":
    case "gemini": {
      if (!config.llmModel) {
        throw new Error(`LLM_MODEL is required for provider "${config.llmProvider}"`);
      }
      return new OpenAiCompatLlmClient(config);
    }
    case "anthropic":
      return new StubLlmClient(config.llmProvider);
    case "stub":
      return new StubLlmClient(config.llmProvider);
  }
}
