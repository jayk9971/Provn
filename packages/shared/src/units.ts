import { USDC_DECIMALS } from "./constants.js";

/** Whole-USDC decimal string: digits, optionally a dot and more digits. No sign, no exponent. */
const AMOUNT_FORMAT = /^(\d+)(?:\.(\d+))?$/;

const SCALE = 10n ** BigInt(USDC_DECIMALS);

/**
 * Convert a whole-USDC decimal string to ERC-20 base units (6 decimals), using integer math
 * only so no floating-point rounding can creep in.
 *
 *   toBaseUnits("0.05") === "50000"
 *   toBaseUnits("5")    === "5000000"
 *
 * Throws on anything that is not a positive amount with at most 6 decimal places.
 * Payments of zero are never valid, so "0" throws too.
 */
export function toBaseUnits(amountUsdc: string): string {
  const match = AMOUNT_FORMAT.exec(amountUsdc.trim());
  if (!match) throw new Error(`Invalid USDC amount: "${amountUsdc}"`);
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  if (fraction.length > USDC_DECIMALS) {
    throw new Error(`USDC amount has more than ${USDC_DECIMALS} decimal places: "${amountUsdc}"`);
  }
  const base = BigInt(whole) * SCALE + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (base === 0n) throw new Error("USDC amount must be greater than zero");
  return base.toString();
}

/**
 * Convert ERC-20 base units (6 decimals) back to a whole-USDC decimal string, without
 * trailing zeros: fromBaseUnits("50000") === "0.05", fromBaseUnits("5000000") === "5".
 */
export function fromBaseUnits(baseUnits: string | bigint): string {
  const value = BigInt(baseUnits);
  if (value < 0n) throw new Error("Base units must not be negative");
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}