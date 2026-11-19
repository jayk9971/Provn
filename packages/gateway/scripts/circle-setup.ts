/**
 * One-time Circle setup for Provn's spender wallet on Arc testnet.
 *
 *   pnpm --filter @provn/gateway exec tsx --env-file=../../.env scripts/circle-setup.ts
 *
 * Run it until it says "Done", adding what it prints to .env between runs:
 *   1. No CIRCLE_ENTITY_SECRET yet → prints a new one. Add it to .env, run again.
 *   2. Registers the entity secret with Circle and saves the recovery file (once).
 *   3. Creates a wallet set and one EOA wallet on ARC-TESTNET. Prints CIRCLE_WALLET_ID and the
 *      address to use as SPENDER_ADDRESS. Add both to .env.
 *   4. Asks Circle's faucet for testnet USDC for gas (Arc pays gas in USDC).
 *
 * Needs CIRCLE_API_KEY from console.circle.com (a TEST_API_KEY for testnet).
 * Never commit the entity secret or the recovery file.
 */
import { existsSync, writeFileSync } from "node:fs";
import {
  generateEntitySecret,
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";

const RECOVERY_FILE = "../../circle-recovery-file.dat";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
const existingWalletId = process.env.CIRCLE_WALLET_ID;

if (!apiKey) {
  console.error("Set CIRCLE_API_KEY in .env first (console.circle.com → API keys, testnet).");
  process.exit(1);
}

if (!entitySecret) {
  console.log("No CIRCLE_ENTITY_SECRET yet. Here is a new one; add it to .env and run again:\n");
  generateEntitySecret();
  process.exit(0);
}

// Step 2: register the entity secret once, the recovery file is the only way to reset it
if (!existsSync(RECOVERY_FILE)) {
  console.log("Registering the entity secret with Circle...");
  const registered = await registerEntitySecretCiphertext({ apiKey, entitySecret });
  writeFileSync(RECOVERY_FILE, registered.data?.recoveryFile ?? "");
  console.log(`Saved ${RECOVERY_FILE}. Keep it somewhere safe and out of git.`);
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

// Step 3: one wallet on Arc testnet, unless .env already names one
let walletId = existingWalletId;
let address: string | undefined;
if (walletId) {
  const wallet = await client.getWallet({ id: walletId });
  address = wallet.data?.wallet?.address;
  console.log(`Using existing wallet ${walletId}`);
} else {
  const set = await client.createWalletSet({ name: "Provn spender" });
  const walletSetId = set.data?.walletSet?.id;
  if (!walletSetId) throw new Error("Circle did not return a wallet set id");
  const created = await client.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "EOA",
  });
  const wallet = created.data?.wallets?.[0];
  if (!wallet) throw new Error("Circle did not return a wallet");
  walletId = wallet.id;
  address = wallet.address;
}
if (!address) throw new Error("Circle did not return the wallet's address");

//testnet USDC for gas -- the faucet might be rate-limited
try {
  await client.requestTestnetTokens({ address, blockchain: "ARC-TESTNET", usdc: true });
  console.log("Requested testnet USDC for gas from Circle's faucet.");
} catch (error) {
  console.warn(
    "Faucet request failed. Fund the wallet from faucet.circle.com instead.",
    error instanceof Error ? error.message : error,
  );
}

console.log(`
Done. Add to .env:

  CIRCLE_WALLET_ID=${walletId}
  SPENDER_ADDRESS=${address}
  WALLET_ADAPTER=circle-dev

Then make it the vault's spender (owner key signs):

  cast send $VAULT_ADDRESS "setSpender(address)" ${address} \\
    --private-key $DEPLOYER_PRIVATE_KEY --rpc-url $ARC_RPC_URL
`);
