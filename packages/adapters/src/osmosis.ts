import type { ChainAdapter } from "@quattestor/core";

/**
 * STUB -- fill in during jadwal jam 29:30-32:30 (CosmWasm/Rust, Vault +
 * Verifier contracts). See architecture doc §5.3, §2.2 col "Osmosis":
 *   - classical sig: secp256k1-Cosmos, verify against pubkey over SHA256 of
 *     the Amino/Direct sign doc (not keccak, not EIP-191)
 *   - counter: sequential, stored in CosmWasm contract state Map, same
 *     pattern as Solana (NOT a random hash key)
 *   - actionHash: keccak256(vault_addr, chain_id, user_addr, amount, nonce)
 *     -- must use crate `sha3` for keccak256, NOT Cosmos SDK's native
 *     sha256, so the formula stays identical across all 5 chains
 *   - pq-sidecar (packages/core/src/pq.ts): reused 100%, 0 changes
 *
 * Unverified before coding starts, per architecture doc §5.3 and §12:
 * exact NOWNodes RPC/gRPC host for Osmosis testnet -- check the NOWNodes
 * dashboard first, don't assume (same mistake that happened with Base
 * Sepolia, see doc §11).
 *
 * GO/NO-GO checkpoints (jam 29:30, 31, 32:30) in PLAN.md gate whether this
 * gets finished at all -- realistic expectation per jadwal §8 is that this
 * stops at one of the checkpoints before full e2e, and that's fine.
 */
export function createOsmosisAdapter(): ChainAdapter {
  const notImplemented = () => {
    throw new Error("osmosis adapter not implemented yet -- see architecture doc §5.3");
  };
  return {
    verifyClassicalSignature: notImplemented,
    state: {
      getCounter: notImplemented,
      isAttested: notImplemented,
      submitAttestation: notImplemented,
    },
    broadcast: {
      executeVaultAction: notImplemented,
    },
  };
}
