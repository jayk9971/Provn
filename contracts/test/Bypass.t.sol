// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProvnVault} from "../src/ProvnVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Demo step 7: an attacker with the stolen spender key skips the gateway. The vault still caps the damage at the daily budget.
contract BypassTest is Test {
    ProvnVault vault;

    address owner = address(this);
    address spender = makeAddr("spender");
    MockUSDC usdc;
    address recipient = makeAddr("recipient");

    uint256 constant PER_TX_MAX = 5e6; // 5 USDC (6 decimals)
    uint256 constant DAILY_BUDGET = 20e6; // 20 USDC

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ProvnVault(address(usdc), spender, PER_TX_MAX, DAILY_BUDGET);
        usdc.mint(address(vault), 100e6);
        vault.setAllowlist(recipient, true);
    }

    function test_AttackerCannotPayUnlistedAddress() public {
        vm.startPrank(spender);
        address attackerWallet = makeAddr("attacker-wallet");
        vm.expectRevert(abi.encodeWithSelector(ProvnVault.NotAllowlisted.selector, attackerWallet));
        vault.spend(attackerWallet, 1e6);
        vm.stopPrank();
    }

    function test_AttackerCannotExceedPerTxMax() public {
        vm.startPrank(spender);
        vm.expectRevert(abi.encodeWithSelector(ProvnVault.ExceedsPerTxMax.selector, PER_TX_MAX + 1, PER_TX_MAX));
        vault.spend(recipient, PER_TX_MAX + 1);
        vm.stopPrank();
    }

    function test_AttackerLossIsCappedAtDailyBudget() public {
        vm.startPrank(spender);
        for (uint256 i = 0; i < 4; i++) {
            vault.spend(recipient, PER_TX_MAX);
        }
        vm.expectRevert(abi.encodeWithSelector(ProvnVault.ExceedsDailyBudget.selector, 1, 0));
        vault.spend(recipient, 1);
        vm.stopPrank();

        assertEq(usdc.balanceOf(recipient), DAILY_BUDGET);
        assertEq(usdc.balanceOf(address(vault)), 100e6 - DAILY_BUDGET);
    }

    function test_OwnerPauseStopsTheAttacker() public {
        vm.startPrank(spender);
        for (uint256 i = 0; i < 4; i++) {
            vault.spend(recipient, PER_TX_MAX);
        }
        vm.stopPrank();

        vault.pause();

        vm.prank(spender);
        vm.expectRevert(ProvnVault.VaultPaused.selector);
        vault.spend(recipient, 1e6);
    }
}
