import { createHmac, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { PaymentExecution } from "../audit/index.js";
import type { WalletAdapter } from "../wallet/index.js";

/**
 * QuickNode reconciliation: every USDC transfer out of the vault must match a payment Provn
 * sent. One that doesn't means money left without the gateway (for example a stolen spender
 * key calling the vault directly), so Provn pauses the vault.
 */

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** A USDC transfer out of the vault, pulled from a QuickNode payload. Addresses lowercase. */
export interface VaultTransfer {
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  amountBaseUnits: string;
}

export interface ChainEvent extends VaultTransfer {
  status: "matched" | "unreconciled";
  proposalId: string | null;
  detail: string;
  pauseTxHash: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Signature

export interface QuickNodeHeaders {
  nonce: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/**
 * Check a QuickNode Streams/Webhooks signature: lowercase hex HMAC-SHA256, keyed with the
 * stream's security token, of nonce + timestamp + body (the decompressed body, as text).
 * Also rejects timestamps more than `maxSkewMs` from now, so an old delivery can't be replayed.
 */
export function verifyQuickNodeSignature(
  body: string,
  headers: QuickNodeHeaders,
  secret: string,
  nowMs: number = Date.now(),
  maxSkewMs: number = 5 * 60_000,
): boolean {
  const { nonce, timestamp, signature } = headers;
  if (!nonce || !timestamp || !signature || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const tsMs = ts < 1e12 ? ts * 1000 : ts; // seconds or milliseconds
  if (Math.abs(nowMs - tsMs) > maxSkewMs) return false;

  const expected = createHmac("sha256", secret)
    .update(nonce + timestamp + body)
    .digest("hex");
  const given = Buffer.from(signature.toLowerCase(), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// ---------------------------------------------------------------------------------------------
// Payload parsing

interface RawLog {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
  transactionHash?: unknown;
  logIndex?: unknown;
}

function isLog(value: unknown): value is RawLog {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as RawLog).topics) &&
    typeof (value as RawLog).transactionHash === "string"
  );
}

/** Last 20 bytes of a 32-byte topic, as a lowercase address. */
function topicToAddress(topic: unknown): string | null {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return "0x" + topic.slice(-40).toLowerCase();
}

function toIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) return Number(value);
  return null;
}

/**
 * Find every USDC Transfer from the vault anywhere in a QuickNode payload. Searching the whole
 * payload means it works with a Streams logs or receipts dataset, a filtered Stream, or a
 * Webhook, whatever wraps the logs.
 */
export function extractVaultTransfers(
  payload: unknown,
  usdcAddress: string,
  vaultAddress: string,
): VaultTransfer[] {
  const usdc = usdcAddress.toLowerCase();
  const vault = vaultAddress.toLowerCase();
  const found = new Map<string, VaultTransfer>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > 12 || value === null || typeof value !== "object") return;
    if (isLog(value)) {
      const topics = value.topics as unknown[];
      const from = topicToAddress(topics[1]);
      const to = topicToAddress(topics[2]);
      const logIndex = toIndex(value.logIndex);
      if (
        typeof value.address === "string" &&
        value.address.toLowerCase() === usdc &&
        typeof topics[0] === "string" &&
        topics[0].toLowerCase() === TRANSFER_TOPIC &&
        from === vault &&
        to &&
        logIndex !== null &&
        typeof value.data === "string" &&
        /^0x[0-9a-fA-F]+$/.test(value.data)
      ) {
        const txHash = (value.transactionHash as string).toLowerCase();
        found.set(`${txHash}:${logIndex}`, {
          txHash,
          logIndex,
          from,
          to,
          amountBaseUnits: BigInt(value.data).toString(),
        });
      }
      return;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      visit(child, depth + 1);
    }
  };

  visit(payload, 0);
  return [...found.values()];
}

// ---------------------------------------------------------------------------------------------
// Storage

export class SqliteChainEventStore {
  constructor(private readonly db: Database.Database) {}

  has(txHash: string, logIndex: number): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM chain_events WHERE tx_hash = ? AND log_index = ?")
        .get(txHash, logIndex) !== undefined
    );
  }

  insert(event: ChainEvent): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO chain_events
           (tx_hash, log_index, from_address, to_address, amount_base_units, status,
            proposal_id, detail, pause_tx_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.txHash,
        event.logIndex,
        event.from,
        event.to,
        event.amountBaseUnits,
        event.status,
        event.proposalId,
        event.detail,
        event.pauseTxHash,
        event.createdAt,
      );
  }

  /** Newest first. */
  list(limit = 50): ChainEvent[] {
    const rows = this.db
      .prepare(
        `SELECT tx_hash, log_index, from_address, to_address, amount_base_units, status,
                proposal_id, detail, pause_tx_hash, created_at
         FROM chain_events ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as {
      tx_hash: string;
      log_index: number;
      from_address: string;
      to_address: string;
      amount_base_units: string;
      status: ChainEvent["status"];
      proposal_id: string | null;
      detail: string;
      pause_tx_hash: string | null;
      created_at: string;
    }[];
    return rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      from: row.from_address,
      to: row.to_address,
      amountBaseUnits: row.amount_base_units,
      status: row.status,
      proposalId: row.proposal_id,
      detail: row.detail,
      pauseTxHash: row.pause_tx_hash,
      createdAt: row.created_at,
    }));
  }
}

// ---------------------------------------------------------------------------------------------
// Reconciler

export interface ReconcilerDeps {
  findExecution: (txHash: string) => PaymentExecution | null;
  events: SqliteChainEventStore;
  wallet: WalletAdapter;
  /**
   * How long to wait for a matching payment record before calling a transfer unreconciled.
   * The wallet returns the tx hash only after the transfer confirms, so QuickNode can report it
   * a few seconds before the gateway records it.
   */
  graceMs?: number;
  now?: () => Date;
}

export class Reconciler {
  private readonly graceMs: number;
  private readonly now: () => Date;
  /** Transfers waiting out the grace period. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly deps: ReconcilerDeps) {
    this.graceMs = deps.graceMs ?? 60_000;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Take transfers from a webhook. Returns at once (QuickNode retries slow endpoints); matching
   * and any pause happen in the background. Duplicates (QuickNode can deliver twice) are skipped.
   */
  ingest(transfers: VaultTransfer[]): { accepted: number; duplicates: number } {
    let accepted = 0;
    let duplicates = 0;
    for (const transfer of transfers) {
      const key = `${transfer.txHash}:${transfer.logIndex}`;
      if (this.inFlight.has(key) || this.deps.events.has(transfer.txHash, transfer.logIndex)) {
        duplicates += 1;
        continue;
      }
      accepted += 1;
      const done = this.check(transfer)
        .catch((error: unknown) => console.error("reconciliation failed", key, error))
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, done);
    }
    return { accepted, duplicates };
  }

  /** Wait for every pending check. For tests and shutdown. */
  async settle(): Promise<void> {
    await Promise.all([...this.inFlight.values()]);
  }

  private async check(transfer: VaultTransfer): Promise<void> {
    let execution = this.deps.findExecution(transfer.txHash);
    if (!execution && this.graceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.graceMs));
      execution = this.deps.findExecution(transfer.txHash);
    }

    const base = { ...transfer, createdAt: this.now().toISOString() };
    const mismatch = execution && describeMismatch(execution, transfer);

    if (execution && !mismatch) {
      this.deps.events.insert({
        ...base,
        status: "matched",
        proposalId: execution.proposalId,
        detail: "Matches a payment Provn sent.",
        pauseTxHash: null,
      });
      return;
    }

    const detail = mismatch ?? "No payment Provn sent has this transaction hash.";
    console.error(`UNRECONCILED VAULT TRANSFER ${transfer.txHash}: ${detail} Pausing the vault.`);
    let pauseTxHash: string | null = null;
    let pauseNote = "Vault paused.";
    try {
      ({ txHash: pauseTxHash } = await this.deps.wallet.pause(
        `Unreconciled transfer ${transfer.txHash}`,
      ));
    } catch (error) {
      pauseNote = `Pausing the vault FAILED: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.deps.events.insert({
      ...base,
      status: "unreconciled",
      proposalId: execution?.proposalId ?? null,
      detail: `${detail} ${pauseNote}`,
      pauseTxHash,
    });
  }
}

function describeMismatch(execution: PaymentExecution, transfer: VaultTransfer): string | null {
  if (execution.recipient !== transfer.to) {
    return `Recipient differs from Provn's record (${execution.recipient}).`;
  }
  if (execution.amountBaseUnits !== transfer.amountBaseUnits) {
    return `Amount differs from Provn's record (${execution.amountBaseUnits} base units).`;
  }
  return null;
}
