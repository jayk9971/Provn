#!/usr/bin/env bash
# fund-vault.sh: Transfer testnet USDC into the SpendVault contract
source .env

if [ -z "$VAULT_ADDRESS" ] || [ -z "$USDC_ADDRESS" ]; then
  echo "Error: VAULT_ADDRESS and USDC_ADDRESS must be set in .env"
  exit 1
fi

AMOUNT="1000000000" # 1000 USDC (6 decimals)
echo "Funding vault at $VAULT_ADDRESS with 1000 USDC..."
cast send "$USDC_ADDRESS" "transfer(address,uint256)(bool)" "$VAULT_ADDRESS" "$AMOUNT" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$ARC_RPC_URL"
echo "Done."
