/** Shorten a long hex value (address, tx hash) to "0x123456…abcd". Short values pass through. */
export function shortHex(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/** A hex value in monospace, shortened, with the full value on hover. */
export function Hex({ value }: { value: string }) {
  return (
    <span className="mono" title={value}>
      {shortHex(value)}
    </span>
  );
}
