import type { LedgerEntry } from "@provn/shared";
import type { Ledger } from "../ledger/index.js";
import { newId, sha256Hex } from "../util.js";

export interface FetchResult {
  /** Ledger entries written for this fetch. The first is always the `untrusted` body. */
  entries: LedgerEntry[];
  status: number;
  body: string;
  paymentRequired?: { payee: string; price: string; host: string };
}

/**
 * Fetches outside content on the agent's behalf. The agent never touches the network itself,
 * so the gateway decides how every byte is labeled.
 */
export interface Fetcher {
  fetch(taskId: string, url: string, headers?: Record<string, string>): Promise<FetchResult>;
}

const PAYEE_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_BODY_BYTES = 200 * 1024; // 200 KB

export class HttpFetcher implements Fetcher {
  constructor(
    private readonly ledger: Ledger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetch(taskId: string, url: string, headers?: Record<string, string>): Promise<FetchResult> {
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        throw new Error(`Redirect blocked: ${response.status}`);
      }

      let body = "";
      if (response.body) {
        const reader = response.body.getReader();
        let bytesRead = 0;
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            bytesRead += value.length;
            if (bytesRead > MAX_BODY_BYTES) {
              const allowed = value.length - (bytesRead - MAX_BODY_BYTES);
              if (allowed > 0) {
                chunks.push(value.subarray(0, allowed));
              }
              body = new TextDecoder().decode(concatUint8Arrays(chunks)) + "\n[truncated: exceeded 200 KB limit]";
              reader.cancel();
              break;
            } else {
              chunks.push(value);
            }
          }
        }
        if (!body) {
          body = new TextDecoder().decode(concatUint8Arrays(chunks));
        }
      } else {
        body = await response.text();
        if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
          body = body.slice(0, MAX_BODY_BYTES) + "\n[truncated: exceeded 200 KB limit]";
        }
      }

      const untrusted: LedgerEntry = {
        id: newId("led"),
        source: "tool:fetch_paid_data",
        origin: host,
        trust: "untrusted",
        contentHash: sha256Hex(body),
        content: body,
        createdAt: new Date().toISOString(),
        taskId,
      };
      this.ledger.append(untrusted);

      const result: FetchResult = {
        entries: [untrusted],
        status: response.status,
        body,
      };

      if (response.status === 402) {
        try {
          const json = JSON.parse(body);
          if (
            typeof json.payee === "string" &&
            PAYEE_REGEX.test(json.payee) &&
            typeof json.price === "string"
          ) {
            const bound: LedgerEntry = {
              id: newId("led"),
              source: "tool:fetch_paid_data:402",
              origin: host,
              trust: "bound",
              contentHash: sha256Hex(json.payee),
              content: json.payee,
              createdAt: new Date().toISOString(),
              taskId,
            };
            this.ledger.append(bound);
            result.entries.push(bound);
            result.paymentRequired = {
              payee: json.payee,
              price: json.price,
              host,
            };
          }
        } catch {
          // Ignore JSON parse error on 402 body
        }
      }

      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
