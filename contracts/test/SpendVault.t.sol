// SPDX-License-Identifier: MIT
solidity
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SpendVault} from "../src/SpendVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000 * 10**6);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SpendVaultTest is Test {
    SpendVault vault;
    MockUSDC usdc;

    address owner = address(this);
    address gateway = address(0x1);
    address user = address(0x2);
    address vendor1 = address(0x3);
    address vendor2 = address(0x4);

    uint256 constant PER_TX_MAX = 50 * 10**6;      // 50 USDC
    uint256 constant DAILY_BUDGET = 100 * 10**6;   // 100 USDC

    function setUp() public {
        usdc = new MockUSDC();
        vault = new SpendVault(address(usdc), gateway, PER_TX_MAX, DAILY_BUDGET);

        // Fund vault with 10,000 USDC
        usdc.transfer(address(vault), 10_000 * 10**6);

        // Allowlist vendor1 and vendor2 globally
        vault.setAllowlist(vendor1, true);
        vault.setAllowlist(vendor2, true);
    }

    function test_HappyPathSpend() public {
        bytes32 proposalId = keccak256("prop1");
        vm.prank(gateway);
        vault.spend(vendor1, 20 * 10**6, proposalId);

        assertEq(vault.spentToday(), 20 * 10**6);
        assertEq(usdc.balanceOf(vendor1), 20 * 10**6);
    }

    function test_RevertWhen_NotGateway() public {
        bytes32 proposalId = keccak256("prop1");
        vm.prank(user);
        vm.expectRevert(SpendVault.UnauthorizedGateway.selector);
        vault.spend(vendor1, 10 * 10**6, proposalId);
    }

    function test_RevertWhen_NotAllowlisted() public {
        address unallowed = address(0x99);
        bytes32 proposalId = keccak256("prop1");
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(SpendVault.NotAllowlisted.selector, unallowed));
        vault.spend(unallowed, 10 * 10**6, proposalId);
    }

    function test_RevertWhen_ExceedsPerTxMax() public {
        bytes32 proposalId = keccak256("prop1");
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(SpendVault.ExceedsPerTxMax.selector, 60 * 10**6, PER_TX_MAX));
        vault.spend(vendor1, 60 * 10**6, proposalId);
    }

    function test_RevertWhen_ExceedsDailyBudget() public {
        bytes32 p1 = keccak256("p1");
        bytes32 p2 = keccak256("p2");

        vm.startPrank(gateway);
        vault.spend(vendor1, 50 * 10**6, p1);

        uint256 requested = 60 * 10**6;
        uint256 remaining = DAILY_BUDGET - 50 * 10**6;
        vm.expectRevert(abi.encodeWithSelector(SpendVault.ExceedsDailyBudget.selector, requested, remaining));
        vault.spend(vendor1, requested, p2);
        vm.stopPrank();
    }

    function test_RevertWhen_ProposalReplayed() public {
        bytes32 proposalId = keccak256("prop1");
        vm.startPrank(gateway);
        vault.spend(vendor1, 10 * 10**6, proposalId);

        vm.expectRevert(abi.encodeWithSelector(SpendVault.ProposalAlreadyUsed.selector, proposalId));
        vault.spend(vendor1, 10 * 10**6, proposalId);
        vm.stopPrank();
    }

    function test_DailyBudgetRollover() public {
        bytes32 p1 = keccak256("p1");
        bytes32 p2 = keccak256("p2");

        vm.prank(gateway);
        vault.spend(vendor1, 50 * 10**6, p1);
        assertEq(vault.spentToday(), 50 * 10**6);

        // Warp 1 day forward
        vm.warp(block.timestamp + 1 days);
        assertEq(vault.spentToday(), 0);

        vm.prank(gateway);
        vault.spend(vendor1, 50 * 10**6, p2);
        assertEq(vault.spentToday(), 50 * 10**6);
    }

    function test_TaskPolicyNarrowingAndExpiry() public {
        address[] memory vendors = new address[](1);
        vendors[0] = vendor1;
        uint64 expires = uint64(block.timestamp + 1 hours);

        vm.prank(gateway);
        vault.setTaskPolicy(vendors, 30 * 10**6, expires);

        // Vendor2 should be forbidden by task policy even though globally allowlisted
        bytes32 p1 = keccak256("p1");
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(SpendVault.TaskVendorNotAllowed.selector, vendor2));
        vault.spend(vendor2, 10 * 10**6, p1);

        // Vendor1 works within task budget
        bytes32 p2 = keccak256("p2");
        vm.prank(gateway);
        vault.spend(vendor1, 20 * 10**6, p2);

        // Exceeding task maxTotal
        bytes32 p3 = keccak256("p3");
        vm.prank(gateway);
        vm.expectRevert();
        vault.spend(vendor1, 20 * 10**6, p3);

        // Warp past expiry
        vm.warp(block.timestamp + 2 hours);
        bytes32 p4 = keccak256("p4");
        vm.prank(gateway);
        vm.expectRevert(SpendVault.TaskPolicyExpired.selector);
        vault.spend(vendor1, 10 * 10**6, p4);
    }

    function test_RevertWhen_TaskPolicyWidens() public {
        address[] memory vendors = new address[](1);
        vendors[0] = vendor1;
        uint64 expires = uint64(block.timestamp + 1 hours);

        // Try setting task maxTotal > dailyBudget
        vm.prank(gateway);
        vm.expectRevert(abi.encodeWithSelector(SpendVault.TaskPolicyExceedsDailyBudget.selector, 200 * 10**6, DAILY_BUDGET));
        vault.setTaskPolicy(vendors, 200 * 10**6, expires);
    }

    function test_PauseBlocksSpend() public {
        vault.pause();
        bytes32 proposalId = keccak256("prop1");
        vm.prank(gateway);
        vm.expectRevert();
        vault.spend(vendor1, 10 * 10**6, proposalId);
    }

    function test_FuzzSpendNeverExceedsDaily(uint96 amount1, uint96 amount2) public {
        vm.assume(amount1 > 0 && amount1 <= 50 * 10**6);
        vm.assume(amount2 > 0 && amount2 <= 50 * 10**6);

        bytes32 p1 = keccak256(abi.encodePacked(amount1));
        bytes32 p2 = keccak256(abi.encodePacked(amount2));

        vm.startPrank(gateway);
        vault.spend(vendor1, amount1, p1);

        if (amount1 + amount2 > DAILY_BUDGET) {
            vm.expectRevert();
            vault.spend(vendor1, amount2, p2);
        } else {
            vault.spend(vendor1, amount2, p2);
            assertEq(vault.spentToday(), amount1 + amount2);
        }
        vm.stopPrank();
    }
}
