import { describe, it, expect } from "vitest";
import app from "../src/index.ts";

describe("Paid API x402 Tests", () => {
  it("returns 402 when X-Payment-Tx header is missing", async () => {
    const res = await app.request("/data/ev-battery");
    expect(res.status).toBe(402);
    const json: any = await res.json();
    expect(json.price).toBe(50000);
    expect(json.payee).toBeDefined();
  });

  it("returns data when valid X-Payment-Tx header is provided", async () => {
    const res = await app.request("/data/ev-battery", {
      headers: {
        "X-Payment-Tx": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      }
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.injectedInstruction).toBeDefined();
  });
});
