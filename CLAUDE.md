# Provn

A security gateway for AI agents that pay with USDC. It records the user's request (trusted), fetches outside content itself (untrusted), and is the only holder of wallet credentials. For every payment it traces where each field came from and only allows payments whose details came from the user or the vendor's own 402 response. A vault contract on Arc testnet enforces hard limits underneath.

Built for the UBC 2026 hackathon. Judges will read the code, so prioritize clarity over cleverness.

## Non-negotiable rules

- The `agent` package must never hold wallet keys or Circle credentials. Only the gateway does. The agent has a gateway session token and nothing else.
- Any error in the payment path returns "deny" (fail closed).
- Content fetched from outside is always labeled "untrusted". Only the 402 payee from the requested host is "bound".
- USDC amounts use the ERC-20 interface (6 decimals), never native USDC (18).
- Never commit `.env` or secrets. Only `.env.example` is tracked, with empty values.

## Repo structure (pnpm workspaces)

- `packages/shared`: types and constants used by every package (`TrustLabel`, `LedgerEntry`, `Decision`, Arc constants)
- `packages/gateway`: Hono HTTP API + MCP server. Modules: `ledger`, `intake`, `fetcher`, `trace`, `policy`, `approvals`, `wallet`, `audit`, `payment`
- `packages/agent`: minimal demo agent, talks to the gateway over MCP
- `packages/paid-api`: demo x402-style paid API, including prompt-injection attack endpoints
- `packages/dashboard`: Vite + React + viem UI
- `contracts/`: Foundry project, `ProvnVault.sol`
- `policies/policy.yaml`: example policy (first match wins, plus a floor)
- `docs/`: architecture notes

## Commands

- Install: `pnpm install` (Node 22.9+; pnpm is pinned via `packageManager`, use `corepack enable`)
- Dev (gateway + paid-api + dashboard): `pnpm dev`
- Build all: `pnpm build`
- Test all (TypeScript): `pnpm test`
- Lint: `pnpm lint`; format: `pnpm format`
- Contracts: `cd contracts && forge build && forge test`
- Clone with submodules (forge-std): `git clone --recurse-submodules`, or `git submodule update --init`

## Code style

- TypeScript strict mode; ESM; relative imports end in `.js`
- Shared types live in `packages/shared/src/types.ts`
- Validate the mandate, HTTP request bodies, and MCP tool inputs with zod (`packages/gateway/src/validation.ts`)
- Arc constants in `packages/shared` are defaults; deployment values (RPC, vault address) come from env vars
- Stubs must say what they should do in a `TODO:` comment and must fail safe (deny, empty, or throw `NotImplementedError`), never allow
- Do not add dependencies without asking first
