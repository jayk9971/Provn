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

    function test_RolloverResetsBudget() public {
        vm.startPrank(spender);
        for (uint256 i = 0; i < 4; i++) {
            vault.spend(recipient, PER_TX_MAX);
        }
        vm.warp(block.timestamp + 1 days);
        vault.spend(recipient, PER_TX_MAX);
        assertEq(vault.spentInCurrentDay(), PER_TX_MAX);
        vm.stopPrank();
    }

    function test_RemainingTodayAfterWarp() public {
        vm.prank(spender);
        vault.spend(recipient, PER_TX_MAX);
        vm.warp(block.timestamp + 1 days);
        assertEq(vault.remainingToday(), DAILY_BUDGET);
    }

    function test_PauseBlocksSpendButOwnerCanWithdraw() public {
        vault.pause();
        vm.prank(spender);
        vm.expectRevert(ProvnVault.VaultPaused.selector);
        vault.spend(recipient, 1e6);

        vault.withdraw(address(this), 1e6);
        assertEq(usdc.balanceOf(address(this)), 1e6);
    }

    function test_UnpauseRestoresSpend() public {
        vault.pause();
        vault.unpause();
        vm.prank(spender);
        vault.spend(recipient, 1e6);
        assertEq(vault.spentToday(), 1e6);
    }

    function test_OnlyOwner_SetAllowlist() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ProvnVault.NotOwner.selector);
        vault.setAllowlist(recipient, false);
    }

    function test_OnlyOwner_SetLimits() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ProvnVault.NotOwner.selector);
        vault.setLimits(1e6, 1e6);
    }

    function test_StrangerCannotPause public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ProvnVault.NotOwner.selector);
        vault.pause();
    }

    function test_SpenderCanPauseButNotUnpause() public {
        vm.prank(spender);
        vault.pause();
        assertTrue(vault.paused());
        vm.prank(spender);
        vm.expectRevert(ProvnVault.NotOwner.selector);
        vault.unpause();
    }

    function test_OnlyOwner_Unpause() public {
        vault.pause();
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ProvnVault.NotOwner.selector);
        vault.unpause();
    }

    function test_OnlyOwner_Withdraw() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ProvnVault.NotOwner.selector);
        vault.withdraw(address(this), 1e6);
    }

    function test_OnlyOwner_SetSpender() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ProvnVault.NotOwner.selector);
        vault.setSpender(makeAddr("newSpender"));
    }

    function test_DepositPullsTokens() public {
        usdc.mint(address(this), 10e6);
        usdc.approve(address(vault), 10e6);
        vault.deposit(10e6);
        assertEq(usdc.balanceOf(address(vault)), 110e6);
    }

    function test_SetSpenderRotates() public {
        address newSpender = makeAddr("newSpender");
        vault.setSpender(newSpender);

        vm.prank(newSpender);
        vault.spend(recipient, 1e6);
        assertEq(vault.spentToday(), 1e6);

        vm.prank(spender);
        vm.expectRevert(ProvnVault.NotSpender.selector);
        vault.spend(recipient, 1e6);
    }

    function test_SetSpenderZeroAddressReverts() public {
        vm.expectRevert(ProvnVault.ZeroAddress.selector);
        vault.setSpender(address(0));
    }

    function testFuzz_NeverExceedsDailyBudget(uint256 a, uint256 b, uint256 c) public {
        a = bound(a, 1, PER_TX_MAX);
        b = bound(b, 1, PER_TX_MAX);
        c = bound(c, 1, PER_TX_MAX);

        vm.startPrank(spender);
        try vault.spend(recipient, a) {} catch {}
        try vault.spend(recipient, b) {} catch {}
        try vault.spend(recipient, c) {} catch {}
        vm.stopPrank();

        assertLe(vault.spentInCurrentDay(), DAILY_BUDGET);
    }
}
