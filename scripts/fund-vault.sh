#!/usr/bin/env bash
# Deposit testnet USDC into ProvnVault. Everything comes from .env; nothing is hardcoded.
#
# Needs in .env: ARC_RPC_URL, USDC_ADDRESS, VAULT_ADDRESS, DEPLOYER_PRIVATE_KEY, FUND_AMOUNT_USDC.
# Amounts use the USDC ERC-20 interface (6 decimals), never native USDC (18).
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

for name in ARC_RPC_URL USDC_ADDRESS VAULT_ADDRESS DEPLOYER_PRIVATE_KEY FUND_AMOUNT_USDC; do
  if [ -z "${!name:-}" ]; then
    echo "Error: $name must be set in $ENV_FILE" >&2
    exit 1
  fi
done

# The USDC ERC-20 interface has 6 decimals. (Native USDC on Arc has 18; do not use it here.)
USDC_DECIMALS=6
AMOUNT="$(cast parse-units "$FUND_AMOUNT_USDC" "$USDC_DECIMALS")"

echo "Depositing $FUND_AMOUNT_USDC USDC ($AMOUNT base units) into $VAULT_ADDRESS..."
cast send "$USDC_ADDRESS" "approve(address,uint256)(bool)" "$VAULT_ADDRESS" "$AMOUNT" \
  --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$ARC_RPC_URL"
cast send "$VAULT_ADDRESS" "deposit(uint256)" "$AMOUNT" \
  --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$ARC_RPC_URL"
echo "Done."
