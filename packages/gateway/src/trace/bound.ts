/**
 * The content of a `bound` ledger entry: what a vendor's 402 response said about how to pay it.
 *
 * The fetcher writes this (as JSON) when the host the agent requested answers with HTTP 402.
 * Trace reads it. Keep both sides in sync with this one definition.
 *
 * Only these fields count. Anything else the vendor put in its response stays in the separate
 * `untrusted` entry for the body, and is never a source of payment details.
 */
export interface BoundPayment {
    /** Payee address from the 402 response. */
    payee: string;
    /** Price the 402 quoted for the requested URL, whole USDC (e.g. "0.05"). */
    price: string;
    /** The URL that was requested (the resource being paid for). */
    url: string;
  }
  
  const ADDRESS_FORMAT = /^0x[0-9a-fA-F]{40}$/;
  const AMOUNT_FORMAT = /^\d+(\.\d{1,6})?$/;
  
  /** Serialize for the fetcher. Normalizes the payee to lowercase. */
  export function serializeBoundPayment(payment: BoundPayment): string {
    return JSON.stringify({
      payee: payment.payee.toLowerCase(),
      price: payment.price,
      url: payment.url,
    });
  }
  
  /** Parse a bound entry's content. Returns null if it is not a well-formed BoundPayment. */
  export function parseBoundPayment(content: string): BoundPayment | null {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const { payee, price, url } = value as Record<string, unknown>;
    if (typeof payee !== "string" || !ADDRESS_FORMAT.test(payee)) return null;
    if (typeof price !== "string" || !AMOUNT_FORMAT.test(price)) return null;
    if (typeof url !== "string") return null;
    return { payee: payee.toLowerCase(), price, url };
  }