# Decision Loop

When an AI agent invokes a payment tool (`pay`), the gateway executes a strict fail-closed pipeline:

1. **Propose**: Receive payment proposal (recipient, amount, memo, x402 metadata).
2. **Normalize**: Resolve aliases against trusted registry and convert decimal USDC to 6-decimal bigint.
3. **Enrich**: Attach provenance ledger entries (`Trust`: `TRUSTED`, `UNTRUSTED`, `DERIVED`, origin tracking) and active task mandate state.
4. **Decide**: Call policy engine `decide()` function. Returns one of `ALLOW`, `DENY`, or `REQUIRE_APPROVAL`.
5. **Execute / Queue**: 
   - If `ALLOW`: Execute transaction through `SpendVault.spend()`.
   - If `REQUIRE_APPROVAL`: Generate cryptographic hash-bound approval and queue for human dashboard sign-off.
   - If `DENY`: Return vague denial message to agent ("denied: requires user approval") while recording detailed rule violation in the append-only audit log.
6. **Fail-Closed**: Any error, timeout, or exception in the pipeline immediately aborts payment and blocks the agent.
