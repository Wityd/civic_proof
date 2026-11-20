// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ProjectWallet
/// @notice Ring-fences ONE project's funds. Deployed by CivicProofFactory, one per project,
///         so every project has its own address and dZAR balance on Snowtrace.
/// @dev Ids are keccak256(utf8 uuid), computed off-chain by the API.
///      Balances are tracked internally, not with token.balanceOf(this), so tokens sent
///      straight to this address cannot push a project past its allocation.
contract ProjectWallet is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MUNICIPALITY_ROLE = keccak256("MUNICIPALITY_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");

    IERC20 public immutable token;
    bytes32 public immutable projectId;
    uint256 public immutable allocated; // budget ceiling, in cents

    uint256 public funded; // total ever deposited
    uint256 public balance; // currently held for this project
    uint256 public committed; // approved but not yet released
    uint256 public released; // total paid out (used from step 5)

    /// @dev "On hold" is deliberately off-chain: a held invoice stays Pending here.
    enum Status {
        None,
        Pending,
        Approved,
        Rejected,
        Released
    }

    struct PaymentRequest {
        address supplier;
        uint256 amount; // cents
        bytes32 invoiceHash; // SHA-256 of the invoice document, anchored at submit
        bytes32 milestoneId; // 0x0 = not delivery-dependent
        Status status;
        uint64 submittedAt;
        uint64 decidedAt;
        uint64 releasedAt;
    }

    /// @dev Milestones must be registered before an invoice can depend on them.
    enum MilestoneStatus {
        None,
        Registered,
        Verified
    }

    mapping(bytes32 => PaymentRequest) private _requests; // requestId = keccak256(invoice uuid)
    mapping(bytes32 => MilestoneStatus) public milestoneStatus; // milestoneId = keccak256(milestone uuid)

    event ProjectFunded(address indexed from, uint256 amount, uint256 newBalance);
    event PaymentRequested(
        bytes32 indexed requestId,
        address indexed supplier,
        uint256 amount,
        bytes32 invoiceHash,
        bytes32 milestoneId
    );
    event PaymentApproved(bytes32 indexed requestId, uint256 amount, uint256 newAvailable);
    event PaymentRejected(bytes32 indexed requestId);
    event PaymentReleased(bytes32 indexed requestId, address indexed supplier, uint256 amount, uint256 newBalance);
    event MilestoneRegistered(bytes32 indexed milestoneId);
    event MilestoneVerified(bytes32 indexed milestoneId);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidHash();
    error ExceedsAllocation(uint256 requested, uint256 remaining);
    error RequestAlreadyExists(bytes32 requestId);
    error RequestNotFound(bytes32 requestId);
    error InvalidStatus(bytes32 requestId, Status current);
    error InsufficientAvailable(uint256 requested, uint256 available);
    error MilestoneAlreadyRegistered(bytes32 milestoneId);
    error MilestoneNotFound(bytes32 milestoneId);
    error MilestoneAlreadyVerified(bytes32 milestoneId);
    error MilestoneNotVerified(bytes32 milestoneId);

    /// @param admin receives the admin, MUNICIPALITY and APPROVER roles
    ///        (the API's server key in the MVP)
    constructor(IERC20 token_, bytes32 projectId_, uint256 allocated_, address admin) {
        if (address(token_) == address(0) || admin == address(0)) revert InvalidAddress();
        if (allocated_ == 0) revert InvalidAmount();
        token = token_;
        projectId = projectId_;
        allocated = allocated_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MUNICIPALITY_ROLE, admin);
        _grantRole(APPROVER_ROLE, admin);
    }

    /// @notice Deposits dZAR into this project, never beyond the allocation.
    /// @dev Caller must first call token.approve(thisWallet, amount).
    function fundProject(uint256 amount) external onlyRole(MUNICIPALITY_ROLE) nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 remaining = allocated - funded;
        if (amount > remaining) revert ExceedsAllocation(amount, remaining);

        funded += amount;
        balance += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ProjectFunded(msg.sender, amount, balance);
    }

    // ── Payment requests ─────────────────────────────────────────────────────

    /// @notice Registers an invoice and anchors its document hash. One request per invoice.
    function submitPaymentRequest(
        bytes32 requestId,
        address supplier,
        uint256 amount,
        bytes32 invoiceHash,
        bytes32 milestoneId
    ) external onlyRole(MUNICIPALITY_ROLE) {
        if (_requests[requestId].status != Status.None) revert RequestAlreadyExists(requestId);
        if (supplier == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (invoiceHash == bytes32(0)) revert InvalidHash();
        if (milestoneId != bytes32(0) && milestoneStatus[milestoneId] == MilestoneStatus.None) {
            revert MilestoneNotFound(milestoneId);
        }

        _requests[requestId] = PaymentRequest({
            supplier: supplier,
            amount: amount,
            invoiceHash: invoiceHash,
            milestoneId: milestoneId,
            status: Status.Pending,
            submittedAt: uint64(block.timestamp),
            decidedAt: 0,
            releasedAt: 0
        });
        emit PaymentRequested(requestId, supplier, amount, invoiceHash, milestoneId);
    }

    /// @notice Commits funds to a pending request. Two approvals can never spend the same money.
    function approvePayment(bytes32 requestId) external onlyRole(APPROVER_ROLE) {
        PaymentRequest storage r = _requirePending(requestId);
        uint256 available = balance - committed;
        if (r.amount > available) revert InsufficientAvailable(r.amount, available);

        committed += r.amount;
        r.status = Status.Approved;
        r.decidedAt = uint64(block.timestamp);
        emit PaymentApproved(requestId, r.amount, balance - committed);
    }

    /// @notice Rejects a pending request. Its funds never leave the wallet.
    function rejectPayment(bytes32 requestId) external onlyRole(APPROVER_ROLE) {
        PaymentRequest storage r = _requirePending(requestId);
        r.status = Status.Rejected;
        r.decidedAt = uint64(block.timestamp);
        emit PaymentRejected(requestId);
    }

    /// @notice Pays an approved request to the supplier, exactly once.
    /// @dev Status and accounting change BEFORE the transfer (checks-effects-interactions),
    ///      and nonReentrant blocks re-entry, so a request can never pay twice.
    function releasePayment(bytes32 requestId) external onlyRole(APPROVER_ROLE) nonReentrant {
        PaymentRequest storage r = _requests[requestId];
        if (r.status == Status.None) revert RequestNotFound(requestId);
        if (r.status != Status.Approved) revert InvalidStatus(requestId, r.status);
        if (r.milestoneId != bytes32(0) && milestoneStatus[r.milestoneId] != MilestoneStatus.Verified) {
            revert MilestoneNotVerified(r.milestoneId);
        }

        r.status = Status.Released;
        r.releasedAt = uint64(block.timestamp);
        committed -= r.amount;
        balance -= r.amount;
        released += r.amount;

        token.safeTransfer(r.supplier, r.amount);
        emit PaymentReleased(requestId, r.supplier, r.amount, balance);
    }

    // ── Milestones ───────────────────────────────────────────────────────────

    /// @notice Registers a delivery milestone (e.g. M1 "8 tanks installed at 4 village sites").
    function registerMilestone(bytes32 milestoneId) external onlyRole(MUNICIPALITY_ROLE) {
        if (milestoneId == bytes32(0)) revert InvalidHash();
        if (milestoneStatus[milestoneId] != MilestoneStatus.None) revert MilestoneAlreadyRegistered(milestoneId);
        milestoneStatus[milestoneId] = MilestoneStatus.Registered;
        emit MilestoneRegistered(milestoneId);
    }

    /// @notice Records official delivery verification. Unlocks payments that depend on it.
    /// @dev Community confirmations are evidence off-chain; only an APPROVER can verify.
    function verifyMilestone(bytes32 milestoneId) external onlyRole(APPROVER_ROLE) {
        MilestoneStatus s = milestoneStatus[milestoneId];
        if (s == MilestoneStatus.None) revert MilestoneNotFound(milestoneId);
        if (s == MilestoneStatus.Verified) revert MilestoneAlreadyVerified(milestoneId);
        milestoneStatus[milestoneId] = MilestoneStatus.Verified;
        emit MilestoneVerified(milestoneId);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// @return balance_ tokens held for the project
    /// @return available balance minus approved-but-unpaid amounts
    function getBalance() external view returns (uint256 balance_, uint256 available) {
        return (balance, balance - committed);
    }

    function getTransaction(bytes32 requestId) external view returns (PaymentRequest memory) {
        PaymentRequest memory r = _requests[requestId];
        if (r.status == Status.None) revert RequestNotFound(requestId);
        return r;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _requirePending(bytes32 requestId) internal view returns (PaymentRequest storage r) {
        r = _requests[requestId];
        if (r.status == Status.None) revert RequestNotFound(requestId);
        if (r.status != Status.Pending) revert InvalidStatus(requestId, r.status);
    }
}
