import { describe, expect, it } from "vitest";
import { toBaseUnits, LocalVaultWalletAdapter } from "../src/wallet/local-vault.js";

describe("local-vault wallet adapter", () => {
  it("converts decimal strings to 6-decimal base units", () => {
    expect(toBaseUnits("0.05")).toBe(50000n);
    expect(toBaseUnits("9.00")).toBe(9000000n);
  });

  it("throws on amounts with > 6 decimals", () => {
    expect(() => toBaseUnits("0.0000001")).toThrow("Amount exceeds 6 decimals");
  });

  it("fromEnv throws if required env vars are missing", () => {
    const env = {};
    expect(() => LocalVaultWalletAdapter.fromEnv(env)).toThrow(/ARC_RPC_URL/);
  });
});
