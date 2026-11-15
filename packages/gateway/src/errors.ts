/** Thrown by stubs. Callers in the payment path treat any throw as a deny (fail closed). */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = "NotImplementedError";
  }
}
