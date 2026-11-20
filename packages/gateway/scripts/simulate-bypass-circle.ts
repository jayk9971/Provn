/**
 * Demo: an attacker with Provn's stolen Circle credentials calls ProvnVault.spend directly
 * through Circle's API, skipping the gateway. The vault allows it (allowlisted payee, within
 * limits). QuickNode reports the transfer, Provn finds no payment it made with that hash, and
 * pauses the vault.
 *
 *   set -a; source .env; set +a      # from the repo root
 *   cd packages/gateway && pnpm exec tsx scripts/simulate-bypass-circle.ts
 *
 * Needs CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID, VAULT_ADDRESS, PAID_API_PAYEE.
 * Optional BYPASS_AMOUNT_USDC (default 0.10).
 */
import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { toBaseUnits } from "@provn/shared";

const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID, VAULT_ADDRESS, PAID_API_PAYEE } =
  process.env;
const amountUsdc = process.env.BYPASS_AMOUNT_USDC || "0.10";

for (const [name, value] of Object.entries({
  CIRCLE_API_KEY,
  CIRCLE_ENTITY_SECRET,
  CIRCLE_WALLET_ID,
  VAULT_ADDRESS,
  PAID_API_PAYEE,
})) {
  if (!value) {
    console.error(`${name} must be set (load .env first: set -a; source .env; set +a)`);
    process.exit(1);
  }
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey: CIRCLE_API_KEY!,
  entitySecret: CIRCLE_ENTITY_SECRET!,
});

console.log(
  `Calling ProvnVault.spend directly (no gateway): ${amountUsdc} USDC to ${PAID_API_PAYEE}`,
);
const created = await client.createContractExecutionTransaction({
  walletId: CIRCLE_WALLET_ID!,
  contractAddress: VAULT_ADDRESS!,
  abiFunctionSignature: "spend(address,uint256)",
  abiParameters: [PAID_API_PAYEE!, toBaseUnits(amountUsdc).toString()],
  fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  idempotencyKey: randomUUID(),
});
const id = created.data?.id;
if (!id) throw new Error("Circle did not return a transaction ID");

const confirmed = await client.getTransaction({
  id,
  waitForState: "CONFIRMED",
  pollingInterval: 1500,
  signal: AbortSignal.timeout(120_000),
});
const txHash = confirmed.data?.transaction?.txHash;
console.log(`Sent: ${txHash}`);
console.log(`https://testnet.arcscan.app/tx/${txHash}`);
console.log(
  "Watch the dashboard: QuickNode reports it, Provn finds no matching payment and pauses the vault.",
);