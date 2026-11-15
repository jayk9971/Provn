import type { LedgerEntry } from "@provn/shared";
import type { Ledger } from "../ledger/index.js";
import { newId, sha256Hex } from "../util.js";

export interface FetchResult {
  /** Ledger entries written for this fetch. The first is always the `untrusted` body. */
  entries: LedgerEntry[];
}

/**
 * Fetches outside content on the agent's behalf. The agent never touches the network itself,
 * so the gateway decides how every byte is labeled.
 */
export interface Fetcher {
  fetch(taskId: string, url: string): Promise<FetchResult>;
}

export class StubFetcher implements Fetcher {
  constructor(private readonly ledger: Ledger) {}

  async fetch(taskId: string, url: string): Promise<FetchResult> {
    // TODO: perform the real HTTP request (timeout, size limit, no redirects to other hosts).
    const body = `TODO: placeholder body for ${url}`;

    // Everything fetched from outside is "untrusted", no matter how it looks.
    const untrusted: LedgerEntry = {
      id: newId("led"),
      source: "tool:fetch_paid_data",
      origin: new URL(url).host,
      trust: "untrusted",
      contentHash: sha256Hex(body),
      content: body,
      createdAt: new Date().toISOString(),
      taskId,
    };
    this.ledger.append(untrusted);

    // TODO: if the response is an HTTP 402, parse the payee from the response and append a
    // SEPARATE ledger entry with trust "bound", origin set to the host that sent the 402.
    // Only the 402 payee from the requested host may ever be "bound".

    return { entries: [untrusted] };
  }
}
