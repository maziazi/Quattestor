// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {Verifier} from "../src/Verifier.sol";

contract QuattestorTest is Test {
    Vault vault;
    Verifier verifier;

    uint256 operatorKey = 0xA11CE;
    uint256 otherKey = 0xBEEF;
    address operator;
    address user = address(0xCAFE);

    function setUp() public {
        operator = vm.addr(operatorKey);
        verifier = new Verifier(operator);
        vault = new Vault(address(verifier));
        vm.deal(address(vault), 10 ether);
    }

    function _actionHash(uint256 amount, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(address(vault), block.chainid, user, amount, nonce));
    }

    function _attest(bytes32 actionHash, uint256 signerKey) internal {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, actionHash);
        verifier.submitAttestation(actionHash, abi.encodePacked(r, s, v));
    }

    function test_happyPath_withdrawAfterAttestation() public {
        uint256 amount = 1 ether;
        bytes32 actionHash = _actionHash(amount, 0);

        _attest(actionHash, operatorKey);
        assertTrue(verifier.isAttested(actionHash));

        vm.prank(user);
        vault.withdraw(amount, 0);

        assertEq(user.balance, amount);
        assertEq(vault.nonces(user), 1);
    }

    function test_revert_withdrawWithoutAttestation() public {
        vm.prank(user);
        vm.expectRevert(Vault.NotAttested.selector);
        vault.withdraw(1 ether, 0);
    }

    function test_revert_attestationFromUntrustedSigner() public {
        bytes32 actionHash = _actionHash(1 ether, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, actionHash);

        vm.expectRevert(Verifier.InvalidOperatorSignature.selector);
        verifier.submitAttestation(actionHash, abi.encodePacked(r, s, v));
    }

    function test_revert_replaySameNonce() public {
        uint256 amount = 1 ether;
        bytes32 actionHash = _actionHash(amount, 0);
        _attest(actionHash, operatorKey);

        vm.prank(user);
        vault.withdraw(amount, 0);

        vm.prank(user);
        vm.expectRevert(Vault.BadNonce.selector);
        vault.withdraw(amount, 0);
    }

    function test_revert_doubleAttestation() public {
        bytes32 actionHash = _actionHash(1 ether, 0);
        _attest(actionHash, operatorKey);

        vm.expectRevert(Verifier.AlreadyAttested.selector);
        _attest(actionHash, operatorKey);
    }

    function test_emitsAttestationSubmitted() public {
        bytes32 actionHash = _actionHash(1 ether, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorKey, actionHash);

        vm.expectEmit(true, true, false, false);
        emit Verifier.AttestationSubmitted(actionHash, address(this));
        verifier.submitAttestation(actionHash, abi.encodePacked(r, s, v));
    }
}
