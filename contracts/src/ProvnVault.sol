// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The only ERC-20 functions the vault needs.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ProvnVault
/// @notice Holds USDC and enforces hard spending limits underneath the Provn gateway.
///         Even if the gateway is tricked or compromised, the spender key can never move more
///         than `perTxMax` per payment, more than `dailyBudget` per day, or pay an address that
///         is not on the allowlist.
/// @dev Skeleton. Amounts are USDC ERC-20 base units (6 decimals), NOT native USDC (18).
contract ProvnVault {
    // ---------------------------------------------------------------- state

    /// @notice Controls limits, allowlist, pause, and withdrawals. Holds the user's authority.
    address public owner;
    /// @notice Provn's key. Can only call `spend`.
    address public spender;
    /// @notice USDC ERC-20 interface address (6 decimals).
    IERC20 public immutable usdc;

    /// @notice Largest single payment, in USDC base units.
    uint256 public perTxMax;
    /// @notice Largest total spend per day, in USDC base units.
    uint256 public dailyBudget;
    /// @notice Spent since `dayStart`, in USDC base units.
    uint256 public spentToday;
    /// @notice Timestamp (UTC midnight) of the day `spentToday` counts for.
    uint256 public dayStart;

    bool public paused;
    /// @notice Addresses `spend` may pay.
    mapping(address => bool) public allowlist;

    // --------------------------------------------------------------- events

    event Spent(address indexed to, uint256 amount);
    // TODO: a reverted `spend` rolls back its own events, so `Blocked` can never be seen.
    // Decide whether to emit it from a non-reverting path (return false) or drop it.
    event Blocked(address indexed to, uint256 amount, string reason);
    event LimitsSet(uint256 perTxMax, uint256 dailyBudget);
    /// @dev Emitted by both `pause` (true) and `unpause` (false).
    event Paused(bool isPaused);
    event AllowlistSet(address indexed account, bool allowed);

    // --------------------------------------------------------- revert reasons

    error NotOwner();
    error NotSpender();
    error VaultPaused();
    error ZeroAddress();
    error NotAllowlisted(address to);
    error ExceedsPerTxMax(uint256 amount, uint256 perTxMax);
    error ExceedsDailyBudget(uint256 amount, uint256 remaining);
    error TransferFailed();

    // ------------------------------------------------------------ modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySpender() {
        if (msg.sender != spender) revert NotSpender();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    // ---------------------------------------------------------- constructor

    constructor(address usdc_, address spender_, uint256 perTxMax_, uint256 dailyBudget_) {
        if (usdc_ == address(0) || spender_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        spender = spender_;
        usdc = IERC20(usdc_);
        perTxMax = perTxMax_;
        dailyBudget = dailyBudget_;
        dayStart = _today();
        emit LimitsSet(perTxMax_, dailyBudget_);
    }

    // ------------------------------------------------------------ functions

    /// @notice Add USDC to the vault. The caller must have approved the vault first.
    function deposit(uint256 amount) external {
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /// @notice Pay `amount` USDC to `to`. Only Provn's spender key may call this.
    function spend(address to, uint256 amount) external onlySpender whenNotPaused {
        if (!allowlist[to]) revert NotAllowlisted(to);
        if (amount > perTxMax) revert ExceedsPerTxMax(amount, perTxMax);

        // Start a new day's count when UTC midnight has passed.
        // forge-lint: disable-next-line(block-timestamp)
        // A day-long window is coarse enough that validator timestamp drift does not matter.
        if (_today() > dayStart) {
            dayStart = _today();
            spentToday = 0;
        }
        uint256 remaining = dailyBudget > spentToday ? dailyBudget - spentToday : 0;
        if (amount > remaining) revert ExceedsDailyBudget(amount, remaining);

        // Update state and emit before the external call (checks-effects-interactions).
        spentToday += amount;
        emit Spent(to, amount);
        if (!usdc.transfer(to, amount)) revert TransferFailed();
    }

    function setAllowlist(address account, bool allowed) external onlyOwner {
        allowlist[account] = allowed;
        emit AllowlistSet(account, allowed);
    }

    function setLimits(uint256 perTxMax_, uint256 dailyBudget_) external onlyOwner {
        // TODO: decide whether to require perTxMax_ <= dailyBudget_.
        perTxMax = perTxMax_;
        dailyBudget = dailyBudget_;
        emit LimitsSet(perTxMax_, dailyBudget_);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /// @notice Owner can always take funds out, even while paused.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (!usdc.transfer(to, amount)) revert TransferFailed();
    }

    // TODO: add `setSpender` so the owner can rotate Provn's key.
    // TODO: add `transferOwnership` (two-step) so ownership can move to a multisig.

    // ------------------------------------------------------------- internal

    /// @dev Timestamp of the most recent UTC midnight.
    function _today() internal view returns (uint256) {
        return block.timestamp - (block.timestamp % 1 days);
    }
}
