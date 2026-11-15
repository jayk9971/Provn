# Architecture Overview

The Agent Spend Firewall consists of four core components working together to ensure safe, verified, and policy-compliant AI agent transactions:

1. **SpendVault (Smart Contract)**
   - Deployed on Arc testnet.
   - Enforces per-transaction caps, daily spending budgets, global allowlists, and temporary narrowing task policies.
   - Only the designated gateway address can call `spend()`.

2. **Gateway (Hono + MCP Server)**
   - Intercepts agent tool calls (`pay`, `fetch_paid_data`).
   - Normalizes requests, extracts mandates and provenance (`Trust`, `Origin`), runs policy evaluation (`decide()`), and records every decision in an append-only SQLite audit log.
   - Executes approved transactions through the vault viem client or queues hash-bound human approvals.

3. **Paid API (x402 Server)**
   - Simulates x402-style monetized endpoints.
   - Rejects unauthenticated requests with HTTP 402 and payment instructions.
   - Verifies cryptographic on-chain payment proofs before serving data (including injected prompt-injection test payloads).

4. **Dashboard (React + Vite + viem)**
   - Real-time management interface.
   - Displays mandate configuration, live provenance ledger, pending approvals, and vault budget usage.
