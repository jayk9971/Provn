import type { AgentConfig } from "./config.js";
import type { LlmClient, Message, LlmResponse, ToolSpec, ToolCall } from "./llm.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: OPENAI_BASE_URL,
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/** The parts of an OpenAI-style chat completion response this client reads. */
interface ChatCompletion {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: {
        id?: string;
        function?: { name?: string; arguments?: string | Record<string, unknown> };
      }[];
    };
  }[];
}

export class OpenAiCompatLlmClient implements LlmClient {
  private readonly baseUrl: string;

  constructor(private readonly config: AgentConfig) {
    this.baseUrl = (config.llmBaseUrl || DEFAULT_BASE_URLS[config.llmProvider] || OPENAI_BASE_URL).replace(/\/+$/, "");
  }

  async complete(messages: Message[], tools: ToolSpec[]): Promise<LlmResponse> {
    const payload = {
      model: this.config.llmModel,
      messages: messages.map((msg) => {
        if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.arguments) },
            })),
          };
        }
        if (msg.role === "tool") {
          return { role: "tool", tool_call_id: msg.toolCallId || "", content: msg.content };
        }
        return { role: msg.role, content: msg.content };
      }),
      tools: tools.length > 0 ? tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) : undefined,
    };

    const response = await this.doFetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.llmApiKey || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: HTTP ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as ChatCompletion;
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    const rawToolCalls = choice?.message?.tool_calls ?? [];

    let autoCallId = 1;
    const toolCalls: ToolCall[] = rawToolCalls.map((call) => {
      let args: Record<string, unknown> = {};
      try {
        if (typeof call.function?.arguments === "string") {
          args = JSON.parse(call.function.arguments);
        } else if (call.function?.arguments && typeof call.function.arguments === "object") {
          args = call.function.arguments;
        }
      } catch {
        args = {};
      }
      return {
        id: call.id || `call_${autoCallId++}`,
        name: call.function?.name || "",
        arguments: args,
      };
    });

    return { text, toolCalls };
  }

  private async doFetch(url: string, options: RequestInit, isRetry = false): Promise<Response> {
    const response = await fetch(url, options);

    if (response.status === 429 && !isRetry) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter ? parseInt(retryAfter, 10) : 2;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return this.doFetch(url, options, true);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  }
}
