// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DemoZAR (dZAR)
/// @notice SIMULATED TEST TOKEN for the CivicProof hackathon demo.
///         It is not real, backed or redeemable currency.
/// @dev 2 decimals, so 1 token unit = 1 cent (R2,000,000.00 = 200000000 units).
///      Only the deployer (owner) can mint, so money cannot appear from nowhere.
contract DemoZAR is ERC20, Ownable {
    constructor() ERC20("DemoZAR (simulated test token)", "dZAR") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    /// @param to recipient (normally the deployer, who then funds a project wallet)
    /// @param amountCents amount in cents
    function mint(address to, uint256 amountCents) external onlyOwner {
        _mint(to, amountCents);
    }
}
