// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVerifier {
    function isAttested(bytes32 actionHash) external view returns (bool);
}

/// @notice Holds native value, releases it only for actions already
/// attested by Verifier. Identical bytecode is deployed, unmodified, to
/// Ethereum Sepolia, Base and Arbitrum -- only the RPC endpoint changes.
contract Vault {
    IVerifier public immutable verifier;
    mapping(address => uint256) public nonces;

    event Withdrawn(address indexed user, uint256 amount, uint256 nonce, bytes32 actionHash);

    error BadNonce();
    error NotAttested();
    error TransferFailed();

    constructor(address _verifier) {
        verifier = IVerifier(_verifier);
    }

    receive() external payable {}

    /// @dev actionHash formula is fixed across all 5 target chains
    /// (EVM/Solana/Osmosis) -- only the encoding mechanics differ.
    function withdraw(uint256 amount, uint256 nonce) external {
        if (nonce != nonces[msg.sender]) revert BadNonce();

        bytes32 actionHash = keccak256(
            abi.encodePacked(address(this), block.chainid, msg.sender, amount, nonce)
        );
        if (!verifier.isAttested(actionHash)) revert NotAttested();

        nonces[msg.sender] = nonce + 1;
        emit Withdrawn(msg.sender, amount, nonce, actionHash);

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
