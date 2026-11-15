import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { decide } from "../policy/decide.ts";
import { executeVaultSpend } from "../vault/index.ts";
import { createPendingApproval } from "../approvals/index.ts";
import { logAudit } from "../audit/index.ts";
import { PaymentProposal, EnrichedProposal, Mandate } from "../types.ts";

const trustedRegistry: Record<string, string> = {
  "research-partner": process.env.PAID_API_PAYEE || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
};

const defaultMandate: Mandate = {
  purpose: "Automated agent research and data acquisition",
  maxTotal: 50n * 10n**6n, // 50 USDC
  allowedVendors: [process.env.PAID_API_PAYEE || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"],
  expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

export const mcpServer = new Server(
  { name: "agent-spend-gateway", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "pay",
        description: "Initiate an agent USDC payment proposal through the Spend Firewall gateway.",
        inputSchema: {
          type: "object",
          properties: {
            recipient: { type: "string", description: "Ethereum address or trusted alias (e.g. research-partner)" },
            amount: { type: "number", description: "Amount in USDC (decimal format, e.g. 0.05)" },
            memo: { type: "string", description: "Payment memo or description" },
            x402Payee: { type: "string", description: "Optional x402 payee address" }
          },
          required: ["recipient", "amount", "memo"]
        }
      },
      {
        name: "fetch_paid_data",
        description: "Fetch paid data from an x402-enabled API endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Target URL of the paid API" }
          },
          required: ["url"]
        }
      }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "pay") {
      const recipientInput = String(args?.recipient || "");
      const decimalAmount = Number(args?.amount || 0);
      const memo = String(args?.memo || "");

      // 1. Normalize alias
      const recipient = trustedRegistry[recipientInput] || recipientInput;
      const amount = BigInt(Math.round(decimalAmount * 1_000_000));
      const proposalId = ("0x" + Math.random().toString(16).substring(2, 14).padStart(64, "0")) as `0x${string}`;

      const proposal: PaymentProposal = {
        proposalId,
        agentId: "test-agent-1",
        actingFor: "user",
        sessionId: "session-1",
        recipient,
        amount,
        memo
      };

      // 2. Enrich proposal
      const recipientOrigin = recipientInput in trustedRegistry ? "registry" : (recipient.startsWith("0x") ? "trusted" : "untrusted");
      const enriched: EnrichedProposal = {
        ...proposal,
        recipientOrigin,
        mandate: defaultMandate,
        spentThisTask: 0n
      };

      // 3. Decide policy
      const decision = decide(enriched);

      // 4. Handle decision
      if (decision.kind === "ALLOW") {
        const txHash = await executeVaultSpend(recipient, amount, proposalId);
        logAudit({
          proposalId,
          decision: "ALLOW",
          rule: decision.rule,
          reason: decision.reason,
          inputs: proposal,
          provenance: { recipientOrigin },
          txHash
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ status: "success", txHash }) }]
        };
      } else if (decision.kind === "REQUIRE_APPROVAL") {
        const approvalInfo = createPendingApproval(proposal);
        logAudit({
          proposalId,
          decision: "REQUIRE_APPROVAL",
          rule: decision.rule,
          reason: decision.reason,
          inputs: proposal,
          provenance: { recipientOrigin }
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ status: "denied", reason: "denied: requires user approval", approvalId: approvalInfo.approvalId }) }]
        };
      } else {
        logAudit({
          proposalId,
          decision: "DENY",
          rule: decision.rule,
          reason: decision.reason,
          inputs: proposal,
          provenance: { recipientOrigin }
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ status: "denied", reason: "denied: requires user approval" }) }]
        };
      }
    } else if (name === "fetch_paid_data") {
      const url = String(args?.url || "");
      // Fetch implementation or simulation
      const res = await fetch(url);
      const text = await res.text();
      return {
        content: [{ type: "text", text }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    // Fail closed
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "error", error: error.message || "Failed closed due to error" }) }],
      isError: true
    };
  }
});
