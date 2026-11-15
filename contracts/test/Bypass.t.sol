// SPDX-License-Identifier: MIT
solidity
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SpendVault} from "../src/SpendVault.sol";
import {MockUSDC} from "./SpendVault.t.sol";

contract BypassTest is Test {
    SpendVault vault;
    MockUSDC usdc;

    address owner = address(this);
    address stolenGatewayKey = address(0xBAD);
    address attackerAddress = address(0x666);
    address legitimateVendor = address(0x3);

    uint256 constant PER_TX_MAX = 50 * 10**6;      // 50 USDC
    uint256 constant DAILY_BUDGET = 100 * 10**6;   // 100 USDC

    function setUp() public {
        usdc = new MockUSDC();
        // Note: stolenGatewayKey is NOT the configured gateway address (gateway is address(0x1))
        vault = new SpendVault(address(usdc), address(0x1), PER_TX_MAX, DAILY_BUDGET);
        usdc.transfer(address(vault), 10_000 * 10**6);
        vault.setAllowlist(legitimateVendor, true);
    }

    function test_AttackerWithStolenKeyCannotSpendDirectly() public {
        bytes32 proposalId = keccak256("attack1");
        vm.prank(stolenGatewayKey);
        vm.expectRevert(SpendVault.UnauthorizedGateway.selector);
        vault.spend(attackerAddress, 10 * 10**6, proposalId);
    }

    function test_GatewayCannotBypassPerTxCapOrAllowlist() public {
        address realGateway = address(0x1);
        bytes32 p1 = keccak256("p1");
        bytes32 p2 = keccak256("p2");
        bytes32 p3 = keccak256("p3");

        vm.startPrank(realGateway);

        // 1. Cannot spend to non-allowlisted address
        vm.expectRevert();
        vault.spend(attackerAddress, 10 * 10**6, p1);

        // 2. Cannot exceed per-tx cap
        vm.expectRevert();
        vault.spend(legitimateVendor, 51 * 10**6, p2);

        // 3. Repeatedly spending up to daily budget, last call over budget reverts
        vault.spend(legitimateVendor, 50 * 10**6, p2);
        vault.spend(legitimateVendor, 50 * 10**6, p3);

        bytes32 p4 = keccak256("p4");
        vm.expectRevert();
        vault.spend(legitimateVendor, 1 * 10**6, p4);

        vm.stopPrank();
    }
}
