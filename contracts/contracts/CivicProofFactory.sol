// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ProjectWallet} from "./ProjectWallet.sol";

/// @title CivicProofFactory
/// @notice Deployed once. Creates one ProjectWallet per project and keeps the
///         public, on-chain list of projectId → wallet address.
contract CivicProofFactory is AccessControl {
    bytes32 public constant MUNICIPALITY_ROLE = keccak256("MUNICIPALITY_ROLE");

    IERC20 public immutable token;

    mapping(bytes32 => address) public walletOf;
    bytes32[] private _projectIds;

    event ProjectCreated(bytes32 indexed projectId, address indexed wallet, uint256 allocated);

    error InvalidAddress();
    error ProjectAlreadyExists(bytes32 projectId, address wallet);
    error ProjectNotFound(bytes32 projectId);

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert InvalidAddress();
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MUNICIPALITY_ROLE, msg.sender);
    }

    /// @notice Deploys a new ProjectWallet. The caller gets its roles.
    /// @param projectId keccak256(utf8 project uuid)
    /// @param allocated budget ceiling in cents (R2,000,000.00 = 200000000)
    function createProject(bytes32 projectId, uint256 allocated)
        external
        onlyRole(MUNICIPALITY_ROLE)
        returns (address wallet)
    {
        address existing = walletOf[projectId];
        if (existing != address(0)) revert ProjectAlreadyExists(projectId, existing);

        wallet = address(new ProjectWallet(token, projectId, allocated, msg.sender));
        walletOf[projectId] = wallet;
        _projectIds.push(projectId);
        emit ProjectCreated(projectId, wallet, allocated);
    }

    /// @notice Reverts if the project doesn't exist (walletOf returns address(0) instead).
    function getWallet(bytes32 projectId) external view returns (address wallet) {
        wallet = walletOf[projectId];
        if (wallet == address(0)) revert ProjectNotFound(projectId);
    }

    function projectCount() external view returns (uint256) {
        return _projectIds.length;
    }

    function allProjects() external view returns (bytes32[] memory) {
        return _projectIds;
    }
}
