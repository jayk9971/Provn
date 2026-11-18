import { describe, expect, it } from "vitest";
import { LocalVaultWalletAdapter } from "../src/wallet/local-vault.js";

const KEY = "0x" + "11".repeat(32);
const VAULT = "0x" + "22".repeat(20);

describe("local-vault wallet adapter", () => {
  it("fromEnv requires a spender key", () => {
    expect(() => LocalVaultWalletAdapter.fromEnv({ VAULT_ADDRESS: VAULT })).toThrow(
      /SPENDER_PRIVATE_KEY/,
    );
  });

  it("fromEnv rejects a malformed key", () => {
    expect(() =>
      LocalVaultWalletAdapter.fromEnv({ SPENDER_PRIVATE_KEY: "0x1234", VAULT_ADDRESS: VAULT }),
    ).toThrow(/SPENDER_PRIVATE_KEY/);
  });

  it("fromEnv requires the vault address", () => {
    expect(() => LocalVaultWalletAdapter.fromEnv({ SPENDER_PRIVATE_KEY: KEY })).toThrow(
      /VAULT_ADDRESS/,
    );
  });

  it("builds from a complete env, defaulting to Arc testnet", () => {
    const adapter = LocalVaultWalletAdapter.fromEnv({
      SPENDER_PRIVATE_KEY: KEY,
      VAULT_ADDRESS: VAULT,
    });
    expect(adapter.kind).toBe("local-vault");
  });

  it("rejects an invalid recipient before touching the chain", async () => {
    const adapter = LocalVaultWalletAdapter.fromEnv({
      SPENDER_PRIVATE_KEY: KEY,
      VAULT_ADDRESS: VAULT,
    });
    await expect(
      adapter.transfer({ idempotencyKey: "p1", to: "not-an-address", amountUsdc: "1" }),
    ).rejects.toThrow(/Invalid recipient/);
  });
});
