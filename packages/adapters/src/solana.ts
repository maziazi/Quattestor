import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { ChainAdapter, VaultActionParams } from "@quattestor/core";

/**
 * Solana ChainAdapter -- architecture doc §5.2. Talks to NOWNodes devnet
 * RPC directly (no @coral-xyz/anchor client, no IDL): instructions are
 * built by hand with Anchor's own discriminator convention
 * (`sha256("global:<ix_name>")[0..8]`) and accounts/state are read as raw
 * account bytes. Same "manual over SDK" choice made for the EVM adapter's
 * transport layer, applied here to the whole client.
 */

const CONFIG_SEED = Buffer.from("config");
const VAULT_SEED = Buffer.from("vault");
const ATTESTATION_SEED = Buffer.from("attestation");

export interface SolanaAdapterConfig {
  rpcUrl: string;
  apiKey: string;
  programId: string;
}

function anchorDiscriminator(ixName: string): Buffer {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

function deriveVaultPda(programId: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_SEED, user.toBuffer()], programId);
}

function deriveConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

function deriveAttestationPda(programId: PublicKey, actionHash: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ATTESTATION_SEED, Buffer.from(actionHash)], programId);
}

/**
 * Same 5 logical inputs as the EVM/Osmosis formula; `program_id` plays the
 * role `chainId` plays on EVM. Must match `handle_withdraw` in
 * `contracts/solana/programs/solana/src/instructions/withdraw.rs` exactly.
 */
export function computeSolanaActionHash(
  vault: PublicKey,
  programId: PublicKey,
  user: PublicKey,
  amount: bigint,
  counter: bigint,
): Uint8Array {
  const amountLe = Buffer.alloc(8);
  amountLe.writeBigUInt64LE(amount);
  const counterLe = Buffer.alloc(8);
  counterLe.writeBigUInt64LE(counter);
  return keccak_256(Buffer.concat([vault.toBuffer(), programId.toBuffer(), user.toBuffer(), amountLe, counterLe]));
}

export function createSolanaAdapter(cfg: SolanaAdapterConfig): ChainAdapter {
  const connection = new Connection(cfg.rpcUrl, {
    commitment: "confirmed",
    httpHeaders: { "api-key": cfg.apiKey },
  });
  const programId = new PublicKey(cfg.programId);
  const [configPda] = deriveConfigPda(programId);

  return {
    async verifyClassicalSignature(message, signature, claimedIdentity) {
      try {
        return ed25519.verify(signature, message, new PublicKey(claimedIdentity).toBytes());
      } catch {
        return false;
      }
    },

    state: {
      // vaultId ignored -- derivable from `user` alone (seeds = [VAULT_SEED, user]).
      async getCounter(_vaultId, user) {
        const [vaultPda] = deriveVaultPda(programId, new PublicKey(user));
        const account = await connection.getAccountInfo(vaultPda);
        if (!account) return 0n;
        return account.data.readBigUInt64LE(8); // 8-byte Anchor discriminator, then counter: u64
      },

      async isAttested(actionHash) {
        const [attestationPda] = deriveAttestationPda(programId, Buffer.from(actionHash.replace(/^0x/, ""), "hex"));
        const account = await connection.getAccountInfo(attestationPda);
        if (!account) return false;
        return account.data.readUInt8(8 + 32) === 1; // discriminator(8) + action_hash(32), then is_attested: bool
      },

      // operatorKey: Solana Keypair (or its secret key bytes) for the
      // trusted operator. Signs and broadcasts submit_attestation itself.
      async submitAttestation(actionHash, operatorKey) {
        const operator = operatorKey instanceof Keypair ? operatorKey : Keypair.fromSecretKey(operatorKey as Uint8Array);
        const actionHashBytes = Buffer.from(actionHash.replace(/^0x/, ""), "hex");
        const [attestationPda] = deriveAttestationPda(programId, actionHashBytes);

        const data = Buffer.concat([anchorDiscriminator("submit_attestation"), actionHashBytes]);
        const ix = new TransactionInstruction({
          programId,
          keys: [
            { pubkey: operator.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: attestationPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        });

        const tx = new Transaction().add(ix);
        return sendAndConfirmTransaction(connection, tx, [operator]);
      },
    },

    broadcast: {
      // userKey: Solana Keypair (or secret key bytes) of the demo wallet.
      async executeVaultAction(params: VaultActionParams, userKey) {
        const user = userKey instanceof Keypair ? userKey : Keypair.fromSecretKey(userKey as Uint8Array);
        const [vaultPda] = deriveVaultPda(programId, user.publicKey);

        const vaultAccount = await connection.getAccountInfo(vaultPda);
        const counter = vaultAccount ? vaultAccount.data.readBigUInt64LE(8) : 0n;
        const actionHash = computeSolanaActionHash(vaultPda, programId, user.publicKey, params.amount, counter);
        const [attestationPda] = deriveAttestationPda(programId, actionHash);

        const amountLe = Buffer.alloc(8);
        amountLe.writeBigUInt64LE(params.amount);
        const data = Buffer.concat([anchorDiscriminator("withdraw"), amountLe, Buffer.from(actionHash)]);

        const ix = new TransactionInstruction({
          programId,
          keys: [
            { pubkey: user.publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: attestationPda, isSigner: false, isWritable: true },
          ],
          data,
        });

        const tx = new Transaction().add(ix);
        return sendAndConfirmTransaction(connection, tx, [user]);
      },
    },
  };
}
