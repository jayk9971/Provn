import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const arcChainId = Number(process.env.ARC_CHAIN_ID || 50420);
const arcRpcUrl = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";

export const arcChain = defineChain({
  id: arcChainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [arcRpcUrl] },
  },
});

const gatewayPrivateKey = (process.env.GATEWAY_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
const vaultAddress = (process.env.VAULT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

const account = privateKeyToAccount(gatewayPrivateKey);

export const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(arcRpcUrl),
});

export const walletClient = createWalletClient({
  account,
  chain: arcChain,
  transport: http(arcRpcUrl),
});

const spendVaultAbi = parseAbi([
  "function spend(address to, uint256 amount, bytes32 proposalId) external",
  "function setTaskPolicy(address[] vendors, uint256 maxTotal, uint64 expires) external",
  "function clearTaskPolicy() external",
  "function spentToday() external view returns (uint256)",
  "function remainingToday() external view returns (uint256)",
  "error UnauthorizedGateway()",
  "error NotAllowlisted(address recipient)",
  "error ExceedsPerTxMax(uint256 amount, uint256 max)",
  "error ExceedsDailyBudget(uint256 requested, uint256 remaining)",
  "error ProposalAlreadyUsed(bytes32 proposalId)",
  "error TaskPolicyExpired()",
  "error TaskVendorNotAllowed(address vendor)"
]);

export async function executeVaultSpend(to: string, amount: bigint, proposalId: `0x${string}`): Promise<string> {
  try {
    const hash = await walletClient.writeContract({
      address: vaultAddress,
      abi: spendVaultAbi,
      functionName: "spend",
      args: [to as `0x${string}`, amount, proposalId],
    });
    return hash;
  } catch (error: any) {
    throw new Error(`Vault spend failed: ${error.message || error}`);
  }
}

export async function readSpentToday(): Promise<bigint> {
  try {
    const data = await publicClient.readContract({
      address: vaultAddress,
      abi: spendVaultAbi,
      functionName: "spentToday",
    });
    return data as bigint;
  } catch {
    return 0n;
  }
}
