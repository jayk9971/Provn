import { describe, expect, it, vi } from "vitest";
import { CircleDevWalletAdapter, type CircleClient } from "../src/wallet/circle-dev.js";

const VAULT = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const TX_HASH = `0x${"ab".repeat(32)}`;

function setup(overrides: { getTransaction?: () => Promise<unknown> } = {}) {
  const createContractExecutionTransaction = vi.fn(async () => ({
    data: { id: "tx-1", state: "INITIATED" },
  }));
  const getTransaction = vi.fn(
    overrides.getTransaction ??
      (async () => ({ data: { transaction: { state: "CONFIRMED", txHash: TX_HASH } } })),
  );
  const client = { createContractExecutionTransaction, getTransaction } as unknown as CircleClient;
  const adapter = new CircleDevWalletAdapter(
    { apiKey: "k", entitySecret: "s", walletId: "wallet-1", vaultAddress: VAULT },
    client,
  );
  return { adapter, createContractExecutionTransaction, getTransaction };
}

describe("CircleDevWalletAdapter.transfer", () => {
  it("calls ProvnVault.spend with 6-decimal base units and returns the tx hash", async () => {
    const { adapter, createContractExecutionTransaction, getTransaction } = setup();

    await expect(adapter.transfer(PAYEE, "0.05")).resolves.toEqual({ txHash: TX_HASH });

    expect(createContractExecutionTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        contractAddress: VAULT,
        abiFunctionSignature: "spend(address,uint256)",
        abiParameters: [PAYEE, "50000"],
      }),
    );
    expect(getTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tx-1", waitForState: "CONFIRMED" }),
    );
  });

  it("throws when the transaction fails (e.g. the vault reverts)", async () => {
    const { adapter } = setup({
      getTransaction: async () => {
        throw new Error("Transaction tx-1 reached terminal state FAILED");
      },
    });
    await expect(adapter.transfer(PAYEE, "0.05")).rejects.toThrow(/FAILED/);
  });

  it("throws when Circle confirms without a tx hash", async () => {
    const { adapter } = setup({
      getTransaction: async () => ({ data: { transaction: { state: "CONFIRMED" } } }),
    });
    await expect(adapter.transfer(PAYEE, "0.05")).rejects.toThrow(/without a tx hash/);
  });

  it("rejects bad input before calling Circle", async () => {
    const { adapter, createContractExecutionTransaction } = setup();
    await expect(adapter.transfer("0xnot-an-address", "0.05")).rejects.toThrow(/not an address/);
    await expect(adapter.transfer(PAYEE, "0")).rejects.toThrow(/greater than zero/);
    expect(createContractExecutionTransaction).not.toHaveBeenCalled();
  });
});

describe("CircleDevWalletAdapter.fromEnv", () => {
  it("requires VAULT_ADDRESS", () => {
    const env = { CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "s", CIRCLE_WALLET_ID: "w" };
    expect(() => CircleDevWalletAdapter.fromEnv(env)).toThrow(/VAULT_ADDRESS/);
    expect(() => CircleDevWalletAdapter.fromEnv({ ...env, VAULT_ADDRESS: "nope" })).toThrow(
      /not an address/,
    );
  });
});