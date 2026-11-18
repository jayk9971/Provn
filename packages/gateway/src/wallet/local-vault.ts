import { createWalletClient, http, parseAbi, parseUnits, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem/chains";
import type { WalletAdapter } from "./index.js";

export function toBaseUnits(amountUsdc: string): bigint {
  if (amountUsdc.split(".")[1]?.length > 6) {
    throw new Error("Amount exceeds 6 decimals");
  }
  return parseUnits(amountUsdc, 6);
}

export class LocalVaultWalletAdapter implements WalletAdapter {
  private constructor(
    private readonly vaultAddress: `0x${string}`,
    private readonly usdcAddress: `0x${string}`,
    private readonly walletClient: any, // viem WalletClient
    private readonly publicClient: any, // viem PublicClient
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): LocalVaultWalletAdapter {
    const rpcUrl = env.ARC_RPC_URL;
    const chainId = env.ARC_CHAIN_ID;
    const vaultAddress = env.VAULT_ADDRESS;
    const usdcAddress = env.USDC_ADDRESS;
    const privateKey = env.SPENDER_PRIVATE_KEY;

    if (!rpcUrl) throw new Error("ARC_RPC_URL is missing");
    if (!chainId) throw new Error("ARC_CHAIN_ID is missing");
    if (!vaultAddress) throw new Error("VAULT_ADDRESS is missing");
    if (!usdcAddress) throw new Error("USDC_ADDRESS is missing");
    if (!privateKey) throw new Error("SPENDER_PRIVATE_KEY is missing");

    const chain = defineChain({
      id: parseInt(chainId, 10),
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });

    const account = privateKeyToAccount(privateKey as Hex);
    const client = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    return new LocalVaultWalletAdapter(
      vaultAddress as `0x${string}`,
      usdcAddress as `0x${string}`,
      client,
      client, // Reusing client for both
    );
  }

  async transfer(to: string, amountUsdc: string): Promise<{ txHash: string }> {
    const amount = toBaseUnits(amountUsdc);
    const hash = await this.walletClient.writeContract({
      address: this.vaultAddress,
      abi: parseAbi(["function spend(address to, uint256 amount)"]),
      functionName: "spend",
      args: [to as `0x${string}`, amount],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction failed: ${hash}`);
    }
    return { txHash: hash };
  }

  async getBalance(): Promise<string> {
    const balance = await this.publicClient.readContract({
      address: this.usdcAddress,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [this.vaultAddress],
    });
    return formatUnits(balance as bigint, 6);
  }
}
