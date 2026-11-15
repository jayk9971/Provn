import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "../src/config.js";
import type { LlmClient, LlmResponse } from "../src/llm.js";
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
        return '{"outcome":"deny"}';
      },
    };

    const answer = await runAgentLoop({ llm, gateway, taskId: "t1" });
    expect(answer).toBe("done");
    expect(calls).toEqual(["pay"]);
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
