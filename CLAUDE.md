# Agent Spend Firewall (Provenance Project)

## Overview
A secure vault, gateway policy enforcement system, x402 paid API server, and dashboard for managing agent spending safely.

## Repo Structure
- `contracts/`: Foundry project for `SpendVault.sol`
- `gateway/`: TypeScript Hono + MCP server for spending policy enforcement and approval handling
- `paid-api/`: x402-style paid API server
- `agent/`: Simple tool-calling test agent
- `dashboard/`: Vite + React + TypeScript + viem UI

## Essential Commands
- Install dependencies: `npm install`
- Build all packages: `npm run build`
- Run Gateway dev server: `npm run dev -w gateway`
- Run Paid API dev server: `npm run dev -w paid-api`
- Run Dashboard dev server: `npm run dev -w dashboard`
- Run Gateway tests: `npm test -w gateway`
- Run Contract tests: `cd contracts && forge test -vvv`
- Build Contracts: `cd contracts && forge build`

## Code Style & Constraints
- TypeScript with strict mode
- Shared types defined in `gateway/src/types.ts`
- Do not invent chain constants; use environment variables
- Fail closed on any payment / policy verification error
