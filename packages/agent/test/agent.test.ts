import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { loadAgentConfig } from "../src/config.js";
import { createLlmClient, type LlmClient, type LlmResponse } from "../src/llm.js";
import { OpenAiCompatLlmClient } from "../src/llm-openai-compat.js";
import { runAgentLoop } from "../src/loop.js";

describe("loadAgentConfig", () => {
  it("requires a task ID and a gateway session token", () => {
    expect(() => loadAgentConfig({ GATEWAY_SESSION_TOKEN: "t" }, [])).toThrow(/Usage/);
    expect(() => loadAgentConfig({}, ["task_1"])).toThrow(/GATEWAY_SESSION_TOKEN/);
  });

  it("reads only gateway and LLM settings", () => {
    const config = loadAgentConfig({ GATEWAY_SESSION_TOKEN: "t", LLM_PROVIDER: "openai" }, [
      "task_1",
    ]);
    expect(config).toMatchObject({ taskId: "task_1", sessionToken: "t", llmProvider: "openai" });
  });

  it("rejects an unknown LLM provider", () => {
    expect(() =>
      loadAgentConfig({ GATEWAY_SESSION_TOKEN: "t", LLM_PROVIDER: "nope" }, ["task_1"]),
    ).toThrow(/LLM_PROVIDER/);
  });
});

describe("createLlmClient", () => {
  it("throws when model is missing for openai/groq/gemini", () => {
    for (const provider of ["openai", "groq", "gemini"] as const) {
      const config = loadAgentConfig({ GATEWAY_SESSION_TOKEN: "t", LLM_PROVIDER: provider }, [
        "task_1",
      ]);
      expect(() => createLlmClient(config)).toThrow(/LLM_MODEL is required/);
    }
  });

  it("succeeds when model is provided", () => {
    const config = loadAgentConfig(
      { GATEWAY_SESSION_TOKEN: "t", LLM_PROVIDER: "openai", LLM_MODEL: "gpt-4o" },
      ["task_1"],
    );
    const client = createLlmClient(config);
    expect(client).toBeInstanceOf(OpenAiCompatLlmClient);
  });
});

describe("OpenAiCompatLlmClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const baseConfig = {
    gatewayUrl: "http://localhost:3001",
    sessionToken: "token",
    taskId: "task_1",
    llmProvider: "openai" as const,
    llmApiKey: "key",
    llmModel: "gpt-4o",
  };

  it("handles plain text reply", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Hello world" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const client = new OpenAiCompatLlmClient(baseConfig);
    const res = await client.complete([{ role: "user", content: "Hi" }], []);
    expect(res).toEqual({ text: "Hello world", toolCalls: [] });
  });

  it("handles reply with one tool call", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_abc",
                    type: "function",
                    function: { name: "pay", arguments: '{"amount":"5"}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const client = new OpenAiCompatLlmClient(baseConfig);
    const res = await client.complete([{ role: "user", content: "Pay 5" }], []);
    expect(res).toEqual({
      text: "",
      toolCalls: [{ id: "call_abc", name: "pay", arguments: { amount: "5" } }],
    });
  });

  it("falls back to empty object on invalid JSON arguments", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call_1",
                    function: { name: "pay", arguments: "invalid json {" },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const client = new OpenAiCompatLlmClient(baseConfig);
    const res = await client.complete([], []);
    expect(res.toolCalls[0].arguments).toEqual({});
  });

  it("generates tool-call id when missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: { name: "pay", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const client = new OpenAiCompatLlmClient(baseConfig);
    const res = await client.complete([], []);
    expect(res.toolCalls[0].id).toBe("call_1");
  });

  it("retries on 429 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Success after retry" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    globalThis.fetch = fetchMock;

    const client = new OpenAiCompatLlmClient(baseConfig);
    const res = await client.complete([], []);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe("Success after retry");
  });
});

describe("runAgentLoop", () => {
  const tools = [{ name: "pay", inputSchema: {} }];

  it("runs requested tools through the gateway, then stops when the model is done", async () => {
    const responses: LlmResponse[] = [
      { text: "paying", toolCalls: [{ id: "c1", name: "pay", arguments: { amount: "1" } }] },
      { text: "done", toolCalls: [] },
    ];
    const llm: LlmClient = { complete: async () => responses.shift() as LlmResponse };
    const calls: string[] = [];
    const gateway = {
      listTools: async () => tools,
      callTool: async (name: string) => {
        calls.push(name);
        if (name === "get_task") {
          return '{"userRequest":"Research EV batteries"}';
        }
        return '{"outcome":"deny"}';
      },
    };

    const answer = await runAgentLoop({ llm, gateway, taskId: "t1" });
    expect(answer).toBe("done");
    expect(calls).toEqual(["get_task", "pay"]);
  });

  it("falls back when get_task throws", async () => {
    const responses: LlmResponse[] = [
      { text: "done", toolCalls: [] },
    ];
    const llm: LlmClient = { complete: async () => responses.shift() as LlmResponse };
    const calls: string[] = [];
    const gateway = {
      listTools: async () => tools,
      callTool: async (name: string) => {
        calls.push(name);
        if (name === "get_task") {
          throw new Error("failed");
        }
        return "ok";
      },
    };

    const answer = await runAgentLoop({ llm, gateway, taskId: "t1" });
    expect(answer).toBe("done");
    expect(calls).toEqual(["get_task"]);
  });

  it("stops after maxSteps if the model never finishes", async () => {
    const llm: LlmClient = {
      complete: async () => ({
        text: "again",
        toolCalls: [{ id: "c", name: "pay", arguments: {} }],
      }),
    };
    const gateway = { listTools: async () => tools, callTool: async () => "ok" };
    const answer = await runAgentLoop({ llm, gateway, taskId: "t1", maxSteps: 3 });
    expect(answer).toMatch(/Stopped after 3 steps/);
  });
});

describe("the agent holds no wallet credentials", () => {
  it("source code never references wallet keys or Circle credentials", () => {
    const forbidden = [/private_?key/i, /circle/i, /entity_?secret/i, /mnemonic/i, /seed phrase/i];
    const dir = new URL("../src/", import.meta.url);
    for (const file of readdirSync(dir)) {
      const text = readFileSync(new URL(file, dir), "utf8");
      for (const pattern of forbidden) {
        expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
