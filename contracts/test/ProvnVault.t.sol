// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProvnVault} from "../src/ProvnVault.sol";

contract ProvnVaultTest is Test {
    ProvnVault vault;

    address owner = address(this);
    address spender = makeAddr("spender");
    address usdc = makeAddr("usdc");
    address recipient = makeAddr("recipient");

    uint256 constant PER_TX_MAX = 5e6; // 5 USDC (6 decimals)
    uint256 constant DAILY_BUDGET = 20e6; // 20 USDC

    function setUp() public {
        vault = new ProvnVault(usdc, spender, PER_TX_MAX, DAILY_BUDGET);
    }

    function test_Deploy() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.spender(), spender);
        assertEq(address(vault.usdc()), usdc);
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
}
