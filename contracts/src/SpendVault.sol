// SPDX-License-Identifier: MIT
solidity
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SpendVault
 * @notice Vault holding USDC with strict policy enforcement, daily budgets, per-transaction caps,
 *         global allowlists, and temporary task-specific narrowing policies. Only the authorized
 *         gateway address can execute spend calls.
 */
contract SpendVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Custom Errors ---
    error UnauthorizedGateway();
    error NotAllowlisted(address recipient);
    error ExceedsPerTxMax(uint256 amount, uint256 max);
    error ExceedsDailyBudget(uint256 requested, uint256 remaining);
    error ProposalAlreadyUsed(bytes32 proposalId);
    error TaskPolicyExpired();
    error TaskVendorNotAllowed(address vendor);
    error TaskPolicyExceedsDailyBudget(uint256 taskMax, uint256 dailyBudget);
    error TooManyTaskVendors(uint256 count);
    error InvalidLimit();

    // --- State Variables ---
    IERC20 public immutable usdc;
    address public gateway;

    uint256 public perTxMax;
    uint256 public dailyBudget;

    // Global allowlist of allowed recipient addresses
    mapping(address => bool) public globalAllowlist;

    // Replay protection for proposal IDs
    mapping(bytes32 => bool) public usedProposals;

    // Daily accounting
    struct DailySpending {
        uint256 day;
        uint256 totalSpent;
    }
    DailySpending public currentDaySpending;

    // Temporary Task Policy
    struct TaskPolicy {
        address[] vendors;
        mapping(address => bool) vendorAllowed;
        uint256 maxTotal;
        uint256 spentSoFar;
        uint64 expires;
        uint64 activeDay;
        bool active;
    }
    TaskPolicy public activeTaskPolicyStruct;

    // --- Events ---
    event Spent(address indexed to, uint256 amount, bytes32 indexed proposalId);
    event GatewayUpdated(address indexed oldGateway, address indexed newGateway);
    event AllowlistUpdated(address indexed recipient, bool allowed);
    event LimitsUpdated(uint256 perTxMax, uint256 dailyBudget);
    event TaskPolicySet(uint256 maxTotal, uint64 expires, uint256 vendorCount);
    event TaskPolicyCleared();
    event Withdrawn(address indexed to, uint256 amount);

    // --- Modifiers ---
    modifier onlyGateway() {
        if (msg.sender != gateway) revert UnauthorizedGateway();
        _;
    }

    constructor(
        address _usdc,
        address _gateway,
        uint256 _perTxMax,
        uint256 _dailyBudget
    ) Ownable(msg.sender) {
        if (_usdc == address(0) || _gateway == address(0)) revert InvalidLimit();
        usdc = IERC20(_usdc);
        gateway = _gateway;
        perTxMax = _perTxMax;
        dailyBudget = _dailyBudget;
    }

    // --- Admin Functions ---

    function setGateway(address _gateway) external onlyOwner {
        if (_gateway == address(0)) revert InvalidLimit();
        emit GatewayUpdated(gateway, _gateway);
        gateway = _gateway;
    }

    function setAllowlist(address recipient, bool allowed) external onlyOwner {
        globalAllowlist[recipient] = allowed;
        emit AllowlistUpdated(recipient, allowed);
    }

    function setLimits(uint256 _perTxMax, uint256 _dailyBudget) external onlyOwner {
        perTxMax = _perTxMax;
        dailyBudget = _dailyBudget;
        emit LimitsUpdated(_perTxMax, _dailyBudget);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // --- Gateway Spend Function ---

    function spend(
        address to,
        uint256 amount,
        bytes32 proposalId
    ) external onlyGateway whenNotPaused nonReentrant {
        if (usedProposals[proposalId]) revert ProposalAlreadyUsed(proposalId);
        if (!globalAllowlist[to]) revert NotAllowlisted(to);
        if (amount > perTxMax) revert ExceedsPerTxMax(amount, perTxMax);

        uint256 currentDay = block.timestamp / 1 days;

        // Reset daily budget if new day
        if (currentDaySpending.day != currentDay) {
            currentDaySpending.day = currentDay;
            currentDaySpending.totalSpent = 0;
        }

        if (currentDaySpending.totalSpent + amount > dailyBudget) {
            revert ExceedsDailyBudget(amount, dailyBudget - currentDaySpending.totalSpent);
        }

        // Check active task policy if set
        TaskPolicy storage policy = activeTaskPolicyStruct;
        if (policy.active) {
            if (block.timestamp > policy.expires) revert TaskPolicyExpired();
            if (policy.activeDay != currentDay) {
                // Task policy day rolled over, reset task spent
                policy.activeDay = currentDay;
                policy.spentSoFar = 0;
            }
            if (!policy.vendorAllowed[to]) revert TaskVendorNotAllowed(to);
            if (policy.spentSoFar + amount > policy.maxTotal) {
                revert ExceedsDailyBudget(amount, policy.maxTotal - policy.spentSoFar);
            }
            policy.spentSoFar += amount;
        }

        usedProposals[proposalId] = true;
        currentDaySpending.totalSpent += amount;

        usdc.safeTransfer(to, amount);
        emit Spent(to, amount, proposalId);
    }

    // --- Task Policy Management ---

    function setTaskPolicy(
        address[] calldata vendors,
        uint256 maxTotal,
        uint64 expires
    ) external {
        if (msg.sender != gateway && msg.sender != owner()) revert UnauthorizedGateway();
        if (vendors.length > 20) revert TooManyTaskVendors(vendors.length);
        if (maxTotal > dailyBudget) revert TaskPolicyExceedsDailyBudget(maxTotal, dailyBudget);

        // Clear existing vendor map
        TaskPolicy storage policy = activeTaskPolicyStruct;
        for (uint256 i = 0; i < policy.vendors.length; i++) {
            policy.vendorAllowed[policy.vendors[i]] = false;
        }

        delete policy.vendors;

        for (uint256 i = 0; i < vendors.length; i++) {
            address vendor = vendors[i];
            if (!globalAllowlist[vendor]) revert TaskVendorNotAllowed(vendor);
            policy.vendorAllowed[vendor] = true;
            policy.vendors.push(vendor);
        }

        policy.maxTotal = maxTotal;
        policy.spentSoFar = 0;
        policy.expires = expires;
        policy.activeDay = uint64(block.timestamp / 1 days);
        policy.active = true;

        emit TaskPolicySet(maxTotal, expires, vendors.length);
    }

    function clearTaskPolicy() external {
        if (msg.sender != gateway && msg.sender != owner()) revert UnauthorizedGateway();
        TaskPolicy storage policy = activeTaskPolicyStruct;
        for (uint256 i = 0; i < policy.vendors.length; i++) {
            policy.vendorAllowed[policy.vendors[i]] = false;
        }
        delete policy.vendors;
        policy.active = false;
        emit TaskPolicyCleared();
    }

    // --- View Helpers ---

    function spentToday() external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        if (currentDaySpending.day != currentDay) {
            return 0;
        }
        return currentDaySpending.totalSpent;
    }

    function remainingToday() external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 spent = (currentDaySpending.day == currentDay) ? currentDaySpending.totalSpent : 0;
        if (spent >= dailyBudget) return 0;
        return dailyBudget - spent;
    }

    function isAllowlisted(address recipient) external view returns (bool) {
        return globalAllowlist[recipient];
    }

    function activeTaskPolicy() external view returns (bool active, uint256 maxTotal, uint256 spentSoFar, uint64 expires) {
        TaskPolicy storage policy = activeTaskPolicyStruct;
        return (policy.active, policy.maxTotal, policy.spentSoFar, policy.expires);
    }
}
