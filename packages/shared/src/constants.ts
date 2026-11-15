/**
 * Arc testnet constants.
 *
 * Packages should treat these as defaults. Deployment-specific values (RPC URL, vault address)
 * come from environment variables; see `.env.example`.
 */

export const ARC_TESTNET_CHAIN_ID = 5042002;

export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";

/** Short network name used in 402 responses. */
export const ARC_TESTNET_NETWORK = "arc-testnet";

/**
 * USDC ERC-20 interface address on Arc testnet.
 *
 * IMPORTANT: native USDC on Arc uses 18 decimals, but the ERC-20 interface uses 6.
 * Always use the ERC-20 (6 decimals) for amounts. Never mix the two.
 */
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

/** Decimals of the USDC ERC-20 interface. Not the 18 decimals of native USDC. */
export const USDC_DECIMALS = 6;

/** HTTP header the agent uses to tell the gateway which task its MCP session belongs to. */
export const TASK_ID_HEADER = "x-provn-task-id";
