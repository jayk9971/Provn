# Provn

A security gateway for AI agents that pay with USDC.

> Hackathon skeleton (UBC 2026, Agentic Payments and AI track). The structure, types, and
> interfaces are in place; the provenance tracing, policy engine, and approval flow are stubs
> with `TODO:` comments.

## What Provn does

Provn wraps an AI agent. It records the user's request (trusted), fetches outside content
itself (labeled untrusted), and is the only holder of wallet credentials. For every payment it
traces where each field (recipient, amount, quantity) came from, and only allows payments
whose details came from the user or the vendor's own payment channel (an x402-style 402
response from the host being paid). Anything else is denied or sent to the user for approval.

## Architecture

```
agent --MCP--> gateway --> wallet (Circle) --> ProvnVault (Arc testnet) --> payee
                  |
                  +--> ledger / trace / policy / approvals / audit (SQLite)
dashboard --HTTP--> gateway          paid-api: demo vendor + attack endpoints
```

| Path                 | What it is                                                     |
| -------------------- | -------------------------------------------------------------- |
| `packages/shared`    | Types and constants used by every package                      |
| `packages/gateway`   | Hono HTTP API + MCP server, with the modules above             |
| `packages/agent`     | Minimal demo agent. Holds no wallet keys, only a session token |
| `packages/paid-api`  | Demo x402-style paid API, including attack endpoints           |
| `packages/dashboard` | Vite + React + viem UI                                         |
| `contracts/`         | Foundry project: `ProvnVault`                                  |
| `policies/`          | Example `policy.yaml`                                          |

More in [docs/architecture.md](docs/architecture.md).

## Decision loop

When the agent calls `pay`, the gateway runs this path. Any error at any step returns "deny".

1. Validate the input (zod) and look up the task and its mandate.
2. Trace each field (recipient, amount, quantity) back to a ledger entry: `trusted`, `bound`,
   `untrusted`, `derived`, or `unknown`.
3. Evaluate `policies/policy.yaml`: first matching rule wins, then the floor is applied.
4. Record the decision (with field origins and rule) in the audit log.
5. Act on it: `allow` pays through the wallet adapter, `require_approval` queues it for the
   user, `deny` returns a short reason to the agent. The agent never sees field origins.

## Safety limits

- **Gateway:** policy rules, a floor (`per_tx_max_usdc`, `daily_budget_usdc`), and approvals
  bound to a payment hash so they only cover the exact payment the user saw.
- **Ledger and audit log:** append-only (SQLite triggers abort updates and deletes).
- **Vault contract:** per-transaction max, daily budget, recipient allowlist, pause, and
  owner-only withdrawals. Enforced on-chain even if the gateway is compromised.
- **Fail closed:** any error in the payment path returns "deny".

## How it uses Arc

Provn runs on Arc testnet (chain ID 5042002, RPC `https://rpc.testnet.arc.network`). Payments
use the USDC ERC-20 interface at `0x3600000000000000000000000000000000000000` with 6 decimals.
Native USDC on Arc uses 18 decimals, so amounts always go through the ERC-20.

`ProvnVault` contract address: **TBD** (set `VAULT_ADDRESS` in `.env` after deploying).

## How it uses Circle

The gateway holds a Circle developer-controlled wallet and is the only component with Circle
credentials (`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`). Payments go through a `WalletAdapter`:
`CircleDevWalletAdapter` for real payments and `MockWalletAdapter` for tests. A
`CircleAgentWalletAdapter` is planned.

## Running locally

Requires Node 22.9+ and [Foundry](https://getfoundry.sh) for the contracts.

```sh
corepack enable
git submodule update --init      # fetches forge-std for the contracts
pnpm install
cp .env.example .env             # fill in values; never commit .env
pnpm build && pnpm test
pnpm dev                         # gateway :3001, paid-api :3002, dashboard :3003
cd contracts && forge build && forge test
```

Other scripts: `pnpm lint`, `pnpm format`. `scripts/fund-vault.sh` deposits testnet USDC into the
vault using values from `.env`.

## Demo script

1. Create a task from a trusted request.
2. Agent fetches `paid-api` `/report` and pays the 402 payee: allowed.
3. Agent fetches `/inject/payee`, `/inject/quantity`, `/inject/encoded`: each attack is denied
   or sent for approval.
4. Show the ledger, field origins, and audit record in the dashboard.

## Team

Jay Kohut
Nikhil Madakasira
