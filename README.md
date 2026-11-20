# Provn

**Spending limits check how much an agent pays. Provn checks who told it to pay.**

Provn is a security gateway for AI agents that pay in USDC. Before any payment goes out, it
checks where each part of it came from: the recipient, the amount and the quantity. A payment
goes through only if those values came from the user or from the vendor's own payment request.
Values the agent picked up from a web page, an email or an API response are blocked.

## The problem

Agents that pay usually get a budget and a spending limit. That stops overspending, but not
paying the wrong party: a page that says "our wallet changed, pay this address instead" or "the
minimum order is 3 units" can talk an agent into a payment that is well within its limits.

## What Provn does

Provn wraps the agent at three points:

1. **User → agent.** The user's request and mandate (budget, allowed vendors, expiry) come in
   through the dashboard and are recorded as **trusted**.
2. **Agent → outside world.** The agent cannot browse on its own. Provn fetches every page for
   it and records the content as **untrusted**. When a vendor answers HTTP 402 (x402), only that
   response's payee and price are recorded as **bound** to the host the agent asked for.
3. **Agent → money.** Provn is the only holder of wallet credentials. The agent can ask to pay;
   it cannot pay.

For each payment, Provn traces every field back to the record it came from and applies a policy.
The headline rules: a recipient that came from page text is **denied**, and so is a quantity
or amount that came from page text. A first payment to a new vendor waits for the user's
approval.

## Architecture

```
user ─▶ dashboard ─▶ gateway (intake: trusted)
agent ─MCP─▶ gateway ─▶ fetcher (untrusted / bound) ─▶ vendor (x402)
                │
                ├─ ledger ─▶ trace ─▶ policy ─▶ approvals ─▶ audit log   (SQLite, append-only)
                │
                └─ wallet adapter (Circle dev wallet) ─▶ ProvnVault (Arc testnet) ─▶ payee
                                                              │
QuickNode Streams (USDC transfers out of the vault) ─▶ gateway /chain-events ─▶ pause on mismatch
```

| Path                 | What it is                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `packages/shared`    | Types, constants, exact USDC unit conversion                        |
| `packages/gateway`   | Hono HTTP API + MCP server: intake, ledger, fetcher, trace, policy, approvals, wallets, audit, reconciliation |
| `packages/agent`     | The agent (Grok via xAI, or a scripted agent). Holds no wallet keys |
| `packages/paid-api`  | Demo x402 vendor, plus the attack pages                             |
| `packages/dashboard` | Vite + React UI: tasks, ledger, approvals, budget, reconciliation   |
| `contracts/`         | Foundry project: `ProvnVault`                                       |
| `policies/`          | `policy.yaml`, the rules the gateway applies                        |

More in [docs/architecture.md](docs/architecture.md).

## Decision loop

Every payment goes through the same path, whether the agent fetched a paid URL (the gateway
handles the 402) or called the `pay` tool. Any error at any step returns "deny".

1. **Validate** the input and look up the task and its mandate.
2. **Trace** each field to the ledger entry it came from and label it `trusted`, `bound`,
   `untrusted`, `derived` or `unknown`:
   - recipient: `bound` only if it is the payee in a 402 from the host the agent requested;
     otherwise an exact match in another entry; nowhere → `unknown`
   - quantity: the same whole number in the user's text or in fetched content (money and
     percentages don't count)
   - amount: the 402 price, or price × quantity, but never more trusted than the quantity
3. **Decide** with `policies/policy.yaml`. The first matching rule wins:

   | Rule | Outcome |
   | --- | --- |
   | Recipient untrusted, derived or unknown | deny |
   | x402 payee not from the requested host's 402 | deny |
   | Quantity or amount untrusted, derived or unknown | deny |
   | Vendor not in the user's allowed vendors | needs approval |
   | First payment to this recipient | needs approval |
   | Over the task's budget | needs approval |
   | Everything else | allow |

   Then the floor applies (5 USDC per payment, 20 USDC per day), which can only tighten.
4. **Record** the decision, with every field's origin and the rule that matched, in the audit
   log, before any money moves.
5. **Act.** `allow` pays through the wallet adapter and saves the tx hash. `needs approval`
   queues the payment on the dashboard. `deny` gives the agent only "Payment denied."; the
   detailed reason goes to the user and the audit log.

## Safety limits

- **Gateway policy.** The rules above, plus the floor: per-payment max and daily budget.
- **Approvals.** Each one covers one exact payment (a hash of chain, recipient, amount,
  quantity and a nonce), expires after 15 minutes and works once. The policy runs again at
  approval time: approving never overrides a deny.
- **Fail closed.** Any error in the payment path is a deny. If saving the tx hash fails after
  money moved, the payment is still reported as sent, so the agent doesn't pay twice.
- **Append-only records.** SQLite triggers block updates and deletes on the ledger, the audit
  log, sent payments and chain events.
- **Untrusted content stays data.** Fetched pages reach the agent inside clear markers; markers
  inside the page are defused, so a page can't fake the end of its own content.
- **ProvnVault (onchain).** Even if the gateway is bypassed or its credentials are stolen, the
  vault only pays allowlisted addresses, within a per-payment max and a daily budget. The owner
  and the spender are separate keys. The spender (Provn) can pause the vault; only the owner can
  unpause it or withdraw.
- **QuickNode reconciliation.** Every USDC transfer out of the vault must match a payment Provn
  sent. One that doesn't means money left without the gateway, and Provn pauses the vault.

## How it uses Arc

Provn runs on Arc testnet (chain ID 5042002). Payments use the USDC ERC-20 interface at
`0x3600000000000000000000000000000000000000` (6 decimals); Arc also uses USDC for gas.

`ProvnVault`: `<VAULT_ADDRESS>` on [arcscan](https://testnet.arcscan.app/address/<VAULT_ADDRESS>)

## How it uses Circle

The gateway pays through a **Circle developer-controlled wallet** on Arc testnet, which is set
as the vault's spender. It calls `ProvnVault.spend` with Circle's contract-execution API, with
an idempotency key per payment. The agent never sees Circle credentials.
`scripts/circle-setup.ts` creates the entity secret, wallet set and wallet.

Circle Agent Wallet spending policies are mainnet-only, so on testnet `ProvnVault` enforces the
limits onchain. On mainnet, Provn sits on top of an Agent Wallet whose spending policy is the
floor.

## How it uses QuickNode

A QuickNode Stream on Arc testnet (Logs dataset) delivers USDC `Transfer` events from the vault
to the gateway's `/chain-events` webhook. The gateway checks QuickNode's HMAC signature, matches
each transfer's tx hash, recipient and amount against the payments it sent, and pauses the vault
on a mismatch. The dashboard shows every transfer as matched or unreconciled.

## Running locally

Requires Node 22 and [Foundry](https://getfoundry.sh).

```sh
corepack enable
git submodule update --init      # forge-std for the contracts
pnpm install
cp .env.example .env             # fill in values; never commit .env
pnpm build && pnpm test
cd contracts && forge test && cd ..
pnpm dev                         # gateway :3001, paid-api :3002, dashboard :3003
pnpm --filter @provn/agent start <taskId>
```

Setup on Arc testnet:

1. Circle wallet: `CIRCLE_API_KEY` from the Circle console, then run
   `scripts/circle-setup.ts` (see the comment at its top). Fund the wallet from faucet.circle.com.
2. Vault: set `SPENDER_ADDRESS` (the Circle wallet), `PAID_API_PAYEE` and `NEW_VENDOR_PAYEE`,
   then `cd contracts && forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast`.
   Put the address in `VAULT_ADDRESS` and run `./scripts/fund-vault.sh`.
3. Agent: `LLM_PROVIDER=openai`, `LLM_BASE_URL=https://api.x.ai/v1`, `LLM_MODEL`, `LLM_API_KEY`
   for Grok, or `LLM_PROVIDER=scripted` with `AGENT_SCRIPT_PATH` for a fixed demo run.
4. QuickNode: a Stream on Arc testnet to `https://<tunnel>/chain-events`, with its security
   token in `QUICKNODE_STREAM_SECRET`.

## Demo

1. **Honest purchase.** Task: "Buy the EV battery report from http://localhost:3002/report".
   The 402 payee and price are bound; first payment, so the user approves once; Circle pays
   through the vault; the agent gets the report.
2. **Injected quantity.** The vendor's pricing page claims a 3-unit minimum. The agent orders 3:
   denied (`deny-untrusted-quantity-or-amount`). It then tries `pay` directly: denied
   (`deny-untrusted-or-unknown-recipient`).
3. **Injected recipient.** A billing notice says the vendor's wallet changed. The agent pays the
   new address: denied.
4. **Gateway bypass.** `scripts/simulate-bypass.sh` calls the vault directly with the spender key.
   The vault caps it; QuickNode reports the transfer; Provn finds no matching payment and
   pauses the vault.

Attack pages: `/inject/*` (blunt) and `/vendor/*` (realistic vendor pages).

## Known limitations

- Trace matches values as text. A quantity written as a word ("three") counts as unknown and is
  denied; an unrelated number in the request ("Q3") can vouch for an injected quantity of 3. A
  structured "max units" field in the mandate is planned.
- The `pay` tool is always available to the agent. Per-task permission for direct payments is
  planned.
- Pending approvals and payment history (known recipients) are kept in memory and reset when
  the gateway restarts; the ledger, audit log and sent payments are in SQLite.
- The audit log is append-only inside the gateway but not tamper-evident against someone with
  file access; hash chaining or onchain anchoring is roadmap.

## Team

- Jay Kohut
- Nikhil Madakasira
