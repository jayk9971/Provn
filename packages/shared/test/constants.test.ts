import { describe, expect, it } from "vitest";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ADDRESS,
  USDC_DECIMALS,
} from "../src/index.js";

describe("Arc testnet constants", () => {
  it("matches the Arc testnet docs", () => {
    expect(ARC_TESTNET_CHAIN_ID).toBe(5042002);
    expect(ARC_TESTNET_RPC_URL).toBe("https://rpc.testnet.arc.network");
    expect(ARC_USDC_ADDRESS).toBe("0x3600000000000000000000000000000000000000");
  });

  it("uses the ERC-20 decimals (6), never native (18)", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
