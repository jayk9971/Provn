# Agent Spend Firewall

A secure vault, gateway policy enforcement system, x402 paid API server, and dashboard for managing agent spending safely.

## Architecture
- **SpendVault (`contracts/`)**: Solidity smart contract enforcing per-transaction caps, daily budgets, allowlists, and temporary narrowing task policies. Only the gateway can call `spend()`.
- **Gateway (`gateway/`)**: Hono + MCP server handling payment proposals, policy decisions (`decide()`), provenance tracking, hash-bound approvals, and audit logging.
- **Paid API (`paid-api/`)**: x402-style server requiring cryptographic on-chain USDC payment proof headers before serving data (including injected prompt-injection payloads for security testing).
- **Dashboard (`dashboard/`)**: Vite + React + TypeScript + viem interface displaying mandates, live provenance ledger, pending approvals, and vault budgets.

## Quick Start
1. Copy `.env.example` to `.env` and fill in keys.
2. Install dependencies: `npm install`
3. Build contracts: `cd contracts && forge build`
4. Run gateway: `npm run dev -w gateway`
5. Run paid API: `npm run dev -w paid-api`
6. Run dashboard: `npm run dev -w dashboard`
