// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProvnVault} from "../src/ProvnVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract ProvnVaultTest is Test {
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

    function test_Deploy() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.spender(), spender);
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.perTxMax(), PER_TX_MAX);
        assertEq(vault.dailyBudget(), DAILY_BUDGET);
        assertEq(vault.spentToday(), 0);
        assertFalse(vault.paused());
    }

    function test_SpendRevertsForNonSpender() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ProvnVault.NotSpender.selector);
        vault.spend(recipient, 1e6);
    }

    function test_SpendMovesTokens() public {
        vm.prank(spender);
        vault.spend(recipient, 1e6);
        assertEq(usdc.balanceOf(recipient), 1e6);
        assertEq(usdc.balanceOf(address(vault)), 99e6);
        assertEq(vault.spentToday(), 1e6);
    }

    function test_SpendRevertsWhenNotAllowlisted() public {
        address stranger = makeAddr("stranger");
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ProvnVault.NotAllowlisted.selector, stranger));
        vault.spend(stranger, 1e6);
    }

    function test_SpendAtPerTxMaxSucceeds() public {
        vm.prank(spender);
        vault.spend(recipient, PER_TX_MAX);
        assertEq(vault.spentToday(), PER_TX_MAX);
    }

    function test_SpendOverPerTxMaxReverts() public {
        vm.prank(spender);
        vm.expectRevert(abi.encodeWithSelector(ProvnVault.ExceedsPerTxMax.selector, PER_TX_MAX + 1, PER_TX_MAX));
        vault.spend(recipient, PER_TX_MAX + 1);
    }

    function test_DailyBudgetEnforced() public {
        vm.startPrank(spender);
        for (uint256 i = 0; i < 4; i++) {
            vault.spend(recipient, PER_TX_MAX);
        }
        vm.expectRevert(abi.encodeWithSelector(ProvnVault.ExceedsDailyBudget.selector, 1, 0));
        vault.spend(recipient, 1);
        vm.stopPrank();
    }
}
