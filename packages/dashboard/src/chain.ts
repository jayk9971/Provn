import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_RPC_URL } from "@provn/shared";
import { createPublicClient, defineChain, http } from "viem";

/**
 * Arc testnet for viem.
 * Native USDC on Arc has 18 decimals (that is what `nativeCurrency` describes). Amounts in
 * Provn always use the USDC ERC-20 interface, which has 6 (USDC_DECIMALS in @provn/shared).
 */
export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_TESTNET_RPC_URL] } },
});

/** TODO: use this to read ProvnVault (spentToday, dailyBudget, perTxMax) for the budget pane. */
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
