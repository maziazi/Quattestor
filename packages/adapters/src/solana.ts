import type { ChainAdapter } from "@quattestor/core";

/**
 * STUB -- fill in during jadwal jam 21:30-29 (Anchor/Rust, `VaultPda`/
 * `AttestationPda`). See architecture doc §5.2, §2.2 col "Solana":
 *   - classical sig: Ed25519, verify directly against pubkey, no recovery
 *   - counter: `counter: u64` field on VaultPda (not a separate nonce account)
 *   - actionHash: keccak256(vault_pda, program_id, user_pubkey, amount, counter)
 *     -- must use keccak256, NOT native sha256, to keep the formula identical
 *     to the EVM adapter
 *   - submit_attestation signer IS the authorization, no separate sig field
 *   - pq-sidecar (packages/core/src/pq.ts): reused 100%, 0 changes
 *
 * GO/NO-GO checkpoints (jam 21:30, 26, 29) in PLAN.md gate whether this gets
 * finished at all -- see jadwal §8 in the architecture doc.
 */
export function createSolanaAdapter(): ChainAdapter {
  const notImplemented = () => {
    throw new Error("solana adapter not implemented yet -- see architecture doc §5.2");
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
