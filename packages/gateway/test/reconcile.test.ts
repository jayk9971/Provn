import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ARC_USDC_ADDRESS, type PaymentProposal } from "@provn/shared";
import { describe, expect, it } from "vitest";
import type { GatewayConfig } from "../src/config.js";
import { createApp } from "../src/http/app.js";
import {
  extractVaultTransfers,
  TRANSFER_TOPIC,
  verifyQuickNodeSignature,
} from "../src/reconcile/index.js";
import { createServices } from "../src/services.js";
import { MockWalletAdapter } from "../src/wallet/index.js";

const SECRET = "qn-test-secret-that-is-more-than-32-bytes";
const VAULT = "0x" + "11".repeat(20);
const PAYEE = "0x" + "ab".repeat(20);
const ATTACKER = "0x" + "ba".repeat(20);
const TX_PAID = "0x" + "01".repeat(32);
const TX_ROGUE = "0x" + "02".repeat(32);

const topic = (address: string) => "0x" + "0".repeat(24) + address.slice(2);

/** A USDC Transfer log as it appears in a QuickNode logs or receipts payload. */
function transferLog(options: {
  txHash: string;
  to: string;
  amountBaseUnits: bigint;
  from?: string;
  token?: string;
  logIndex?: string;
}) {
  return {
    address: options.token ?? ARC_USDC_ADDRESS,
    topics: [TRANSFER_TOPIC, topic(options.from ?? VAULT), topic(options.to)],
    data: "0x" + options.amountBaseUnits.toString(16).padStart(64, "0"),
    transactionHash: options.txHash,
    logIndex: options.logIndex ?? "0x0",
    blockNumber: "0x10",
  };
}

function sign(body: string, nowMs = Date.now(), nonce = `n-${Math.random()}`) {
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = createHmac("sha256", SECRET)
    .update(nonce + timestamp + body)
    .digest("hex");
  return { "x-qn-nonce": nonce, "x-qn-timestamp": timestamp, "x-qn-signature": signature };
}

describe("QuickNode signature", () => {
  const body = '{"hello":"world"}';
  const headers = (h: Record<string, string>) => ({
    nonce: h["x-qn-nonce"],
    timestamp: h["x-qn-timestamp"],
    signature: h["x-qn-signature"],
  });

  it("accepts a correct signature", () => {
    expect(verifyQuickNodeSignature(body, headers(sign(body)), SECRET)).toBe(true);
  });

  it("rejects the wrong secret, a changed body, or missing headers", () => {
    const h = headers(sign(body));
    expect(verifyQuickNodeSignature(body, h, "another-secret")).toBe(false);
    expect(verifyQuickNodeSignature(body + " ", h, SECRET)).toBe(false);
    expect(verifyQuickNodeSignature(body, { ...h, nonce: undefined }, SECRET)).toBe(false);
  });

  it("rejects an old delivery", () => {
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    expect(verifyQuickNodeSignature(body, headers(sign(body, tenMinutesAgo)), SECRET)).toBe(false);
  });
});

describe("extractVaultTransfers", () => {
  it("finds vault transfers however the payload nests them, and ignores everything else", () => {
    const payload = {
      data: [
        [
          transferLog({ txHash: TX_PAID, to: PAYEE, amountBaseUnits: 50_000n }),
          // Incoming transfer, other token, other event: all ignored.
          transferLog({
            txHash: TX_PAID,
            from: PAYEE,
            to: VAULT,
            amountBaseUnits: 1n,
            logIndex: "0x1",
          }),
          transferLog({
            txHash: TX_PAID,
            to: PAYEE,
            amountBaseUnits: 1n,
            token: "0x" + "99".repeat(20),
          }),
          {
            ...transferLog({ txHash: TX_PAID, to: PAYEE, amountBaseUnits: 1n }),
            topics: ["0xdead"],
          },
        ],
        {
          receipts: [
            {
              logs: [transferLog({ txHash: TX_ROGUE, to: ATTACKER, amountBaseUnits: 3_000_000n })],
            },
          ],
        },
      ],
    };
    expect(extractVaultTransfers(payload, ARC_USDC_ADDRESS, VAULT.toUpperCase())).toEqual([
      { txHash: TX_PAID, logIndex: 0, from: VAULT, to: PAYEE, amountBaseUnits: "50000" },
      { txHash: TX_ROGUE, logIndex: 0, from: VAULT, to: ATTACKER, amountBaseUnits: "3000000" },
    ]);
  });

  it("counts a log once even if the payload repeats it", () => {
    const log = transferLog({ txHash: TX_PAID, to: PAYEE, amountBaseUnits: 5n });
    expect(extractVaultTransfers([log, [log]], ARC_USDC_ADDRESS, VAULT)).toHaveLength(1);
  });
});

const config: GatewayConfig = {
  port: 0,
  sessionToken: "test-token",
  dbPath: ":memory:",
  policyPath: undefined,
  walletAdapter: "mock",
  quicknodeSecret: SECRET,
  vaultAddress: VAULT,
  reconcileGraceMs: 0,
};

function setup(overrides: Partial<GatewayConfig> = {}) {
  const wallet = new MockWalletAdapter();
  const cfg = { ...config, ...overrides };
  const services = createServices(cfg, { wallet });
  const app = createApp(services, cfg);
  const deliver = (
    payload: unknown,
    options: { gzip?: boolean; headers?: Record<string, string> } = {},
  ) => {
    const body = JSON.stringify(payload);
    return app.request("/chain-events", {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.headers ?? sign(body)) },
      body: options.gzip ? gzipSync(body) : body,
    });
  };
  /** Pretend Provn paid this tx: the row the pipeline writes after a payment. */
  const recordPaid = (txHash: string, recipient: string, amountUsdc: string) =>
    services.audit.recordTx(
      {
        id: `prop_${txHash.slice(2, 8)}`,
        taskId: "task_1",
        recipient,
        amountUsdc,
      } as PaymentProposal,
      txHash,
    );
  return { app, services, wallet, deliver, recordPaid };
}

describe("POST /chain-events", () => {
  it("refuses deliveries when reconciliation isn't configured", async () => {
    const { deliver } = setup({ quicknodeSecret: undefined });
    expect((await deliver([])).status).toBe(503);
  });

  it("refuses a bad signature and doesn't act on it", async () => {
    const { deliver, wallet } = setup();
    const res = await deliver(
      [transferLog({ txHash: TX_ROGUE, to: ATTACKER, amountBaseUnits: 1n })],
      {
        headers: sign("something else"),
      },
    );
    expect(res.status).toBe(401);
    expect(wallet.pauses).toEqual([]);
  });

  it("refuses a replayed delivery", async () => {
    const { app } = setup();
    const body = "[]";
    const headers = { "content-type": "application/json", ...sign(body, Date.now(), "same-nonce") };
    expect((await app.request("/chain-events", { method: "POST", headers, body })).status).toBe(
      200,
    );
    expect((await app.request("/chain-events", { method: "POST", headers, body })).status).toBe(
      409,
    );
  });

  it("marks a transfer Provn made as matched and leaves the vault running", async () => {
    const { deliver, services, wallet, recordPaid } = setup();
    recordPaid(TX_PAID, PAYEE, "0.05");
    const res = await deliver(
      [[transferLog({ txHash: TX_PAID, to: PAYEE, amountBaseUnits: 50_000n })]],
      {
        gzip: true,
      },
    );
    expect(await res.json()).toEqual({ transfers: 1, accepted: 1, duplicates: 0 });
    await services.reconciler.settle();

    expect(wallet.pauses).toEqual([]);
    expect(services.chainEvents.list()).toMatchObject([{ txHash: TX_PAID, status: "matched" }]);
  });

  it("pauses the vault on a transfer Provn didn't make", async () => {
    const { deliver, services, wallet, app } = setup();
    await deliver([transferLog({ txHash: TX_ROGUE, to: ATTACKER, amountBaseUnits: 3_000_000n })]);
    await services.reconciler.settle();

    expect(wallet.pauses).toEqual([`Unreconciled transfer ${TX_ROGUE}`]);
    expect((await wallet.getStatus()).paused).toBe(true);
    const [event] = services.chainEvents.list();
    expect(event).toMatchObject({ txHash: TX_ROGUE, status: "unreconciled", to: ATTACKER });
    expect(event?.detail).toMatch(/No payment Provn sent.*Vault paused/);

    // The dashboard sees it.
    expect(await (await app.request("/chain-events")).json()).toHaveLength(1);
    expect(await (await app.request("/status")).json()).toMatchObject({ paused: true });
  });

  it("pauses when the hash matches but the amount doesn't", async () => {
    const { deliver, services, wallet, recordPaid } = setup();
    recordPaid(TX_PAID, PAYEE, "0.05");
    await deliver([transferLog({ txHash: TX_PAID, to: PAYEE, amountBaseUnits: 5_000_000n })]);
    await services.reconciler.settle();
    expect(wallet.pauses).toHaveLength(1);
    expect(services.chainEvents.list()[0]?.detail).toMatch(/Amount differs/);
  });

  it("waits out the grace period: a payment recorded a moment late still matches", async () => {
    const { deliver, services, wallet, recordPaid } = setup({ reconcileGraceMs: 50 });
    await deliver([transferLog({ txHash: TX_PAID, to: PAYEE, amountBaseUnits: 50_000n })]);
    recordPaid(TX_PAID, PAYEE, "0.05"); // QuickNode was faster than the wallet's confirmation
    await services.reconciler.settle();
    expect(wallet.pauses).toEqual([]);
    expect(services.chainEvents.list()[0]?.status).toBe("matched");
  });

  it("handles the same transfer only once when QuickNode delivers it twice", async () => {
    const { deliver, services, wallet } = setup();
    const payload = [transferLog({ txHash: TX_ROGUE, to: ATTACKER, amountBaseUnits: 1n })];
    await deliver(payload);
    await services.reconciler.settle();
    const again = await deliver(payload);
    expect(await again.json()).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(wallet.pauses).toHaveLength(1);
    expect(services.chainEvents.list()).toHaveLength(1);
  });

  it("keeps chain events append-only", async () => {
    const { deliver, services } = setup();
    await deliver([transferLog({ txHash: TX_ROGUE, to: ATTACKER, amountBaseUnits: 1n })]);
    await services.reconciler.settle();
    expect(() => services.db.prepare("DELETE FROM chain_events").run()).toThrow(/append-only/);
  });
});
