#!/usr/bin/env bash
# Demo: an attacker with the spender key calls ProvnVault.spend directly, skipping the gateway.
# The vault allows it (allowlisted payee, within limits). QuickNode reports the transfer,
# Provn finds no payment it sent with that hash, and pauses the vault.
#
# Needs in .env: ARC_RPC_URL, VAULT_ADDRESS, SPENDER_PRIVATE_KEY (local-vault setup), and
# PAID_API_PAYEE (an allowlisted payee). Optional: BYPASS_AMOUNT_USDC (default 1).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in ARC_RPC_URL VAULT_ADDRESS SPENDER_PRIVATE_KEY PAID_API_PAYEE; do
  if [ -z "${!name:-}" ]; then
    echo "Error: $name must be set in $ENV_FILE" >&2
    exit 1
  fi
done

USDC_DECIMALS=6
AMOUNT="$(cast parse-units "${BYPASS_AMOUNT_USDC:-1}" "$USDC_DECIMALS")"

echo "Calling ProvnVault.spend directly (no gateway): ${BYPASS_AMOUNT_USDC:-1} USDC to $PAID_API_PAYEE"
cast send "$VAULT_ADDRESS" "spend(address,uint256)" "$PAID_API_PAYEE" "$AMOUNT" \
  --private-key "$SPENDER_PRIVATE_KEY" --rpc-url "$ARC_RPC_URL"
echo "Sent. Watch the dashboard: QuickNode should report it and Provn should pause the vault."
