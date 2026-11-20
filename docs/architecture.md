# Architecture

Provn sits between an AI agent and its money. The agent can read and reason, but it cannot
pay. Only the gateway can, and the gateway pays only when it can show where every payment
detail came from.

## Components

```
              +----------------------------- gateway -----------------------------+
agent --MCP-->| mcp   -> payment pipeline                                         |
              |            intake    task + mandate from the trusted user request |
              |            fetcher   outside content -> "untrusted" ledger entries|
              |            trace     proposal fields -> ledger entries (origins)  |
              |            policy    policy.yaml rules + floor -> Decision        |
              |            approvals human approval bound to a payment hash       |
              |            audit     decision record with origins and rule        |
              |            wallet    WalletAdapter -> Circle -> ProvnVault        |
dashboard --->| http  -> /tasks, /tasks/:id/ledger, /approvals, /approvals/:id/approve
              +-------------------------------------------------------------------+
```

- **shared** defines the vocabulary: `TrustLabel`, `LedgerEntry`, `Mandate`, `PaymentProposal`,
`FieldOrigin`, `Decision`, `Approval`, and the Arc constants.
- **gateway** is the trusted core. Everything the agent sees comes through its two MCP tools,
`fetch_paid_data(url)` and `pay(recipient, amount, memo)`.
- **agent** is a minimal tool-calling loop. It holds only a gateway session token.
- **paid-api** is a demo vendor: `/report` answers 402 with a payee, and `/inject/`* serve
prompt-injection attacks (wrong quantity, wrong payee, base64-hidden payee).
- **dashboard** shows the mandate, the live ledger with trust badges, pending approvals, and
the budget.
- **ProvnVault** limits damage on-chain: per-transaction max, daily budget, allowlist, pause.

## Trust labels

| Label       | Meaning                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `trusted`   | Typed by the user and recorded by the gateway.                                    |
| `bound`     | The payee in a 402 response from the host being paid. Trusted for that host only. |
| `untrusted` | Anything fetched from outside.                                                    |
| `derived`   | Computed by the agent or model from other entries.                                |

A payment goes through without approval only when its recipient, amount, and quantity trace to  
`trusted` or `bound` entries.