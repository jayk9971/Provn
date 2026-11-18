// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ProvnVault} from "../src/ProvnVault.sol";

/// @notice Deploys ProvnVault to Arc testnet. Reads everything from the environment.
///
///   source .env
///   forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
///
/// `arc_testnet` is defined in foundry.toml and resolves to ARC_RPC_URL.
/// Required env: DEPLOYER_PRIVATE_KEY, USDC_ADDRESS, SPENDER_ADDRESS,
///               PER_TX_MAX_USDC_BASE_UNITS, DAILY_BUDGET_USDC_BASE_UNITS.
/// Optional env: PAID_API_PAYEE, NEW_VENDOR_PAYEE.
/// Amounts are USDC ERC-20 base units (6 decimals): 5 USDC = 5000000.
contract Deploy is Script {
    function run() external returns (ProvnVault vault) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address spender = vm.envAddress("SPENDER_ADDRESS");
        uint256 perTxMax = vm.envUint("PER_TX_MAX_USDC_BASE_UNITS");
        uint256 dailyBudget = vm.envUint("DAILY_BUDGET_USDC_BASE_UNITS");

        vm.startBroadcast(deployerKey);
        vault = new ProvnVault(usdc, spender, perTxMax, dailyBudget);
        address paidApiPayee = vm.envOr("PAID_API_PAYEE", address(0));
        address newVendorPayee = vm.envOr("NEW_VENDOR_PAYEE", address(0));
        if (paidApiPayee != address(0)) { vault.setAllowlist(paidApiPayee, true); console.log("Allowlisted", paidApiPayee); }
        if (newVendorPayee != address(0)) { vault.setAllowlist(newVendorPayee, true); console.log("Allowlisted", newVendorPayee); }
        vm.stopBroadcast();

        console.log("ProvnVault deployed at", address(vault));
    }
}
