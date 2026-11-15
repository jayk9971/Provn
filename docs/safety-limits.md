# Safety Limits

The Agent Spend Firewall implements defense-in-depth security limits across multiple layers:

1. **Smart Contract Layer (`SpendVault.sol`)**
   - **Per-Transaction Cap**: Hard maximum amount per individual transaction (`perTxMax`).
   - **Daily Budget**: Rolling 24-hour spending limit (`dailyBudget`) bucketed by `block.timestamp / 1 days`.
   - **Global Allowlist**: Only pre-approved recipient addresses can receive funds.
   - **Task-Specific Narrowing Policies**: Temporary policies that can only tighten (never loosen) global limits, restricted to a max of 20 vendors and capped at daily budget.
   - **Replay Protection**: Unique `proposalId` hash tracking ensures proposal reuse is impossible.
   - **Emergency Controls**: Owner-managed pause mechanism (`pause()` / `unpause()`) and fund withdrawal.

2. **Gateway Layer**
   - **Hash-Bound Approvals**: Human approval payloads are cryptographically bound to transaction parameters (`keccak256(recipient, amount, chainId, nonce)`), preventing frontrunning or parameter substitution.
   - **Append-Only Audit Logging**: SQLite decision log cannot be modified or deleted.
   - **Fail-Closed Principle**: Any runtime failure or policy ambiguity results in transaction denial.
