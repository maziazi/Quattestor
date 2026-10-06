// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";
import {Verifier} from "../src/Verifier.sol";

/// @dev Same script deploys to ETH Sepolia, Base and Arbitrum.
/// Only --rpc-url changes between runs -- 0 lines of code change.
/// Usage:
///   forge script script/Deploy.s.sol \
///     --rpc-url $ETH_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        address trustedOperator = vm.envAddress("TRUSTED_OPERATOR_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        Verifier verifier = new Verifier(trustedOperator);
        Vault vault = new Vault(address(verifier));
        vm.stopBroadcast();

        console.log("chainid        ", block.chainid);
        console.log("trustedOperator", trustedOperator);
        console.log("Verifier        ", address(verifier));
        console.log("Vault           ", address(vault));
    }
}
