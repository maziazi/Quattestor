// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice On-chain enforcement point for Quattestor PQC attestations.
/// Checks a classical ECDSA signature from the trusted Operator over an
/// actionHash that was only produced after the Verifier Service validated
/// both the user's classical signature AND their ML-DSA (post-quantum)
/// signature off-chain. The chain never sees the raw PQC signature.
contract Verifier {
    address public immutable trustedOperator;
    mapping(bytes32 => bool) public attested;

    event AttestationSubmitted(bytes32 indexed actionHash, address indexed operator);

    error AlreadyAttested();
    error InvalidOperatorSignature();
    error BadSignatureLength();

    constructor(address _trustedOperator) {
        trustedOperator = _trustedOperator;
    }

    /// @param actionHash canonical hash of the action intent, see Vault.withdraw
    /// @param operatorSig 65-byte ECDSA signature (r,s,v) by trustedOperator
    ///        over the raw actionHash (no EIP-191 prefix).
    function submitAttestation(bytes32 actionHash, bytes calldata operatorSig) external {
        if (attested[actionHash]) revert AlreadyAttested();
        if (_recover(actionHash, operatorSig) != trustedOperator) revert InvalidOperatorSignature();
        attested[actionHash] = true;
        emit AttestationSubmitted(actionHash, msg.sender);
    }

    function isAttested(bytes32 actionHash) external view returns (bool) {
        return attested[actionHash];
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignatureLength();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
