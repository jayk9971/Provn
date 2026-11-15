import { loadAgentConfig } from "./config.js";
import { connectToGateway } from "./gateway-client.js";
import { createLlmClient } from "./llm.js";
import { runAgentLoop } from "./loop.js";

const config = loadAgentConfig();
const gateway = await connectToGateway(config);

try {
  const answer = await runAgentLoop({
    llm: createLlmClient(config),
    gateway,
    taskId: config.taskId,
  });
  console.log(answer);
} finally {
  await gateway.close();
}
