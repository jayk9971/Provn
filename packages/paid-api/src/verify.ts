import { ARC_TESTNET_RPC_URL, ARC_USDC_ADDRESS } from "@provn/shared";

const TX_HASH_FORMAT = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const usedHashes = new Set<string>();

export function clearUsedHashes(): void {
  usedHashes.clear();
}

export async function verifyPayment(
  txHash: string,
  payee: string,
  minBaseUnits: bigint,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!TX_HASH_FORMAT.test(txHash)) {
    return false;
  }

  const normalizedHash = txHash.toLowerCase();
  if (usedHashes.has(normalizedHash)) {
    return false;
  }

  const rpcUrl = env.ARC_RPC_URL || ARC_TESTNET_RPC_URL;
  const expectedUsdc = (env.USDC_ADDRESS || ARC_USDC_ADDRESS).toLowerCase();
  const targetPayee = payee.toLowerCase().replace(/^0x/, "");

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash],
        id: 1,
      }),
    });

    if (!res.ok) {
      return false;
    }

    const json = (await res.json()) as {
      result?: {
        status?: string;
        logs?: Array<{
          address?: string;
          topics?: string[];
          data?: string;
        }>;
      } | null;
    };

    const receipt = json.result;
    if (!receipt || receipt.status !== "0x1" || !receipt.logs) {
      return false;
    }

    let verified = false;

    for (const log of receipt.logs) {
      if (!log.address || log.address.toLowerCase() !== expectedUsdc) {
        continue;
      }
      if (!log.topics || log.topics.length < 3) {
        continue;
      }
      if (log.topics[0].toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) {
        continue;
      }

      const topic2 = log.topics[2].toLowerCase().replace(/^0x/, "");
      if (!topic2.endsWith(targetPayee)) {
        continue;
      }

      const amount = BigInt(log.data || "0x0");
      if (amount >= minBaseUnits) {
        verified = true;
        break;
      }
    }

    if (verified) {
      usedHashes.add(normalizedHash);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
