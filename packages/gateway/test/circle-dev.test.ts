import { describe, expect, it, vi } from "vitest";
import {
  CircleDevWalletAdapter,
  toUuid,
  type CircleClient,
  type VaultReader,
} from "../src/wallet/circle-dev.js";

const VAULT = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const TX_HASH = `0x${"ab".repeat(32)}`;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Fake chain state in base units (6 decimals). */
const CHAIN = {
  balanceOf: 42_500_000n, // 42.5 USDC in the vault
  perTxMax: 5_000_000n,
  dailyBudget: 20_000_000n,
  spentToday: 3_250_000n,
  dayStart: BigInt(Math.floor(Date.now() / 86_400_000) * 86_400), // today, UTC midnight
  paused: false,
};

function setup(
  overrides: { getTransaction?: () => Promise<unknown>; chain?: Partial<typeof CHAIN> } = {},
) {
  const createContractExecutionTransaction = vi.fn(async () => ({
    data: { id: "tx-1", state: "INITIATED" },
  }));
  const getTransaction = vi.fn(
    overrides.getTransaction ??
      (async () => ({ data: { transaction: { state: "CONFIRMED", txHash: TX_HASH } } })),
  );
  const client = { createContractExecutionTransaction, getTransaction } as unknown as CircleClient;
  const chain = { ...CHAIN, ...overrides.chain };
  const reader: VaultReader = {
    readContract: vi.fn(async ({ functionName }) => chain[functionName as keyof typeof chain]),
  };
  const adapter = new CircleDevWalletAdapter(
    { apiKey: "k", entitySecret: "s", walletId: "wallet-1", vaultAddress: VAULT },
    { client, reader },
  );
  return { adapter, createContractExecutionTransaction, getTransaction, reader };
}

const pay = (overrides: Partial<{ to: string; amountUsdc: string }> = {}) => ({
  idempotencyKey: "prop_123",
  to: PAYEE,
  amountUsdc: "0.05",
  ...overrides,
});

describe("CircleDevWalletAdapter.transfer", () => {
  it("calls ProvnVault.spend with 6-decimal base units and returns the tx hash", async () => {
    const { adapter, createContractExecutionTransaction, getTransaction } = setup();

    await expect(adapter.transfer(pay())).resolves.toEqual({ txHash: TX_HASH });

    expect(createContractExecutionTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        contractAddress: VAULT,
        abiFunctionSignature: "spend(address,uint256)",
        abiParameters: [PAYEE, "50000"],
        idempotencyKey: toUuid("spend:prop_123"),
      }),
    );
    expect(getTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tx-1", waitForState: "CONFIRMED" }),
    );
  });

  it("sends the same Circle idempotency key when a proposal is retried", async () => {
    const { adapter, createContractExecutionTransaction } = setup();
    await adapter.transfer(pay());
    await adapter.transfer(pay());
    const keys = createContractExecutionTransaction.mock.calls.map(
      (call) => (call as unknown as [{ idempotencyKey: string }])[0].idempotencyKey,
    );
    expect(keys[0]).toMatch(UUID_FORMAT);
    expect(keys[0]).toBe(keys[1]);
  });

  it("throws when the transaction fails (e.g. the vault reverts)", async () => {
    const { adapter } = setup({
      getTransaction: async () => {
        throw new Error("Transaction tx-1 reached terminal state FAILED");
      },
    });
    await expect(adapter.transfer(pay())).rejects.toThrow(/FAILED/);
  });

  it("throws when Circle confirms without a tx hash", async () => {
    const { adapter } = setup({
      getTransaction: async () => ({ data: { transaction: { state: "CONFIRMED" } } }),
    });
    await expect(adapter.transfer(pay())).rejects.toThrow(/without a tx hash/);
  });

  it("rejects bad input before calling Circle", async () => {
    const { adapter, createContractExecutionTransaction } = setup();
    await expect(adapter.transfer(pay({ to: "0xnot-an-address" }))).rejects.toThrow(
      /not an address/,
    );
    await expect(adapter.transfer(pay({ amountUsdc: "0" }))).rejects.toThrow(/greater than zero/);
    expect(createContractExecutionTransaction).not.toHaveBeenCalled();
  });
});

describe("CircleDevWalletAdapter.getStatus", () => {
  it("reads the vault's balance and limits as whole USDC", async () => {
    const { adapter } = setup();
    await expect(adapter.getStatus()).resolves.toEqual({
      balanceUsdc: "42.5",
      perTxMaxUsdc: "5",
      dailyBudgetUsdc: "20",
      spentTodayUsdc: "3.25",
      remainingTodayUsdc: "16.75",
      paused: false,
    });
  });

  it("treats spentToday as 0 once a new UTC day has started", async () => {
    const { adapter } = setup({ chain: { dayStart: CHAIN.dayStart - 86_400n } });
    const status = await adapter.getStatus();
    expect(status.spentTodayUsdc).toBe("0");
    expect(status.remainingTodayUsdc).toBe("20");
  });
});

describe("CircleDevWalletAdapter.pause", () => {
  it("calls ProvnVault.pause through Circle", async () => {
    const { adapter, createContractExecutionTransaction } = setup();
    await expect(adapter.pause("unmatched transfer")).resolves.toEqual({ txHash: TX_HASH });
    expect(createContractExecutionTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ abiFunctionSignature: "pause()", abiParameters: [] }),
    );
  });

  it("does nothing if the vault is already paused", async () => {
    const { adapter, createContractExecutionTransaction } = setup({ chain: { paused: true } });
    await expect(adapter.pause("again")).resolves.toEqual({ txHash: null });
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

describe("toUuid", () => {
  it("is deterministic and UUID-shaped", () => {
    expect(toUuid("spend:prop_1")).toBe(toUuid("spend:prop_1"));
    expect(toUuid("spend:prop_1")).not.toBe(toUuid("spend:prop_2"));
    expect(toUuid("spend:prop_1")).toMatch(UUID_FORMAT);
  });
});