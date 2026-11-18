import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits } from "../src/units.js";

describe("toBaseUnits", () => {
  it("converts whole-USDC strings to 6-decimal base units", () => {
    expect(toBaseUnits("0.05")).toBe("50000");
    expect(toBaseUnits("5")).toBe("5000000");
    expect(toBaseUnits("5.00")).toBe("5000000");
    expect(toBaseUnits("0.000001")).toBe("1");
    expect(toBaseUnits("1234.5")).toBe("1234500000");
  });

  it("rejects more than 6 decimal places", () => {
    expect(() => toBaseUnits("0.0000001")).toThrow(/decimal places/);
  });

  it("rejects zero, negatives and malformed input", () => {
    for (const bad of ["0", "0.000000", "-1", "1e6", "", "abc", "1.", ".5", "1,000"]) {
      expect(() => toBaseUnits(bad), bad).toThrow();
    }
  });
});

describe("fromBaseUnits", () => {
  it("converts base units back without trailing zeros", () => {
    expect(fromBaseUnits("50000")).toBe("0.05");
    expect(fromBaseUnits("5000000")).toBe("5");
    expect(fromBaseUnits(1n)).toBe("0.000001");
  });

  it("round-trips", () => {
    for (const amount of ["0.05", "5", "12.345678", "0.1"]) {
      expect(fromBaseUnits(toBaseUnits(amount))).toBe(amount);
    }
  });
});