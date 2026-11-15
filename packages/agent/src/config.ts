export type LlmProvider = "anthropic" | "openai" | "stub";

/**
 * Everything the agent knows. Note what is NOT here: no wallet keys and no payment-provider
 * credentials. The agent can only ask the gateway to pay. It cannot pay by itself.
 */
export interface AgentConfig {
  gatewayUrl: string;
  /** Proves to the gateway that this process is an authorized agent session. */
  sessionToken: string;
  taskId: string;
  llmProvider: LlmProvider;
  llmApiKey: string | undefined;
}

/** Read agent settings from env vars and the command line (`agent <taskId>`). */
export function loadAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): AgentConfig {
  const taskId = argv[0];
  if (!taskId) throw new Error("Usage: agent <taskId>");

  const sessionToken = env.GATEWAY_SESSION_TOKEN;
  if (!sessionToken) throw new Error("GATEWAY_SESSION_TOKEN must be set");

  const llmProvider = env.LLM_PROVIDER ?? "stub";
  if (llmProvider !== "anthropic" && llmProvider !== "openai" && llmProvider !== "stub") {
    throw new Error(`LLM_PROVIDER must be "anthropic", "openai" or "stub", got "${llmProvider}"`);
  }

  return {
    gatewayUrl: env.GATEWAY_URL ?? `http://localhost:${env.GATEWAY_PORT ?? 3001}`,
    sessionToken,
    taskId,
    llmProvider,
    llmApiKey: env.LLM_API_KEY || undefined,
  };
}
