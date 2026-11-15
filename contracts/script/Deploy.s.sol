// SPDX-License-Identifier: MIT
solidity
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SpendVault} from "../src/SpendVault.sol";
import {console} from "forge-std/Console.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 gatewayPrivateKey = vm.envUint("GATEWAY_PRIVATE_KEY");
        address gatewayAddress = vm.addr(gatewayPrivateKey);
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address paidApiPayee = vm.envAddress("PAID_API_PAYEE");

        uint256 perTxMax = 50 * 10**6;      // 50 USDC
        uint256 dailyBudget = 100 * 10**6;   // 100 USDC

        vm.startBroadcast(deployerPrivateKey);

        SpendVault vault = new SpendVault(usdcAddress, gatewayAddress, perTxMax, dailyBudget);

        if (paidApiPayee != address(0)) {
            vault.setAllowlist(paidApiPayee, true);
            console.log("Allowlisted PAID_API_PAYEE:", paidApiPayee);
        }

        vm.stopBroadcast();

        console.log("SpendVault deployed at:", address(vault));
        console.log("Gateway address:", gatewayAddress);
    }
}
