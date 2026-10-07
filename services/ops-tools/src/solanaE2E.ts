import { createHash } from "node:crypto";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateKeyPair, pqMessage, pqSign, pqVerify } from "@quattestor/core";
import { createSolanaAdapter, computeSolanaActionHash } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * E2E happy-path demo for Solana devnet (GO/NO-GO #3, PLAN.md fase Solana).
 * Unlike the EVM flow, this talks to the ChainAdapter directly instead of
 * going through verifier-service's HTTP API -- that service's orchestrator
 * hashes with `computeActionHash` (Solidity ABI encoding, EVM-only), which
 * is not what `handle_withdraw` in the Anchor program expects. The dual-sign
 * + verify steps below mirror what Orchestrator.processAttestation does,
 * just inlined here using `computeSolanaActionHash` instead.
 *
 * Also covers two setup steps the adapter has no instructions for yet
 * (`initialize_config`, `initialize_vault`) since nothing has called them
 * on this program ID before.
 */

const CONFIG_SEED = Buffer.from("config");
const VAULT_SEED = Buffer.from("vault");

function discriminator(ixName: string): Buffer {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function loadKeypair(envVar: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(requireEnv(envVar)));
}

async function main() {
  const rpcUrl = requireEnv("SOLANA_DEVNET_RPC_URL");
  const programId = new PublicKey(requireEnv("SOLANA_PROGRAM_ID"));
  const connection = new Connection(rpcUrl, "confirmed");

  const deployer = loadKeypair("SOLANA_DEPLOYER_SECRET_KEY");
  const operator = loadKeypair("SOLANA_OPERATOR_SECRET_KEY");
  const user = loadKeypair("SOLANA_USER_SECRET_KEY");

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED, user.publicKey.toBuffer()], programId);

  // 1. initialize_config (one-time per program deployment)
  if (!(await connection.getAccountInfo(configPda))) {
    const data = Buffer.concat([discriminator("initialize_config"), operator.publicKey.toBuffer()]);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: deployer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [deployer]);
    console.log("initialize_config tx:", sig);
  } else {
    console.log("config already initialized, skipping");
  }

  // 2. initialize_vault (one-time per user)
  let vaultAccount = await connection.getAccountInfo(vaultPda);
  if (!vaultAccount) {
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: discriminator("initialize_vault"),
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [user]);
    console.log("initialize_vault tx:", sig);
    vaultAccount = await connection.getAccountInfo(vaultPda);
  } else {
    console.log("vault already initialized, skipping");
  }

  // 3. fund the vault PDA so withdraw() has lamports to pay out
  const fundLamports = 5_000_000; // 0.005 SOL buffer
  const fundSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: vaultPda, lamports: fundLamports }),
    ),
    [deployer],
  );
  console.log(`fund vault tx (+${fundLamports} lamports):`, fundSig);

  // 4. compute actionHash for a demo withdraw of 0.001 SOL
  const amount = 1_000_000n;
  const counter = vaultAccount!.data.readBigUInt64LE(8);
  const actionHashBytes = computeSolanaActionHash(vaultPda, programId, user.publicKey, amount, counter);
  const actionHash = toHex(actionHashBytes);
  console.log("actionHash:", actionHash);

  // 5. dual-sign off-chain (classical ed25519 + ML-DSA-87), same pattern as signer-script
  const classicalSignature = ed25519.sign(actionHashBytes, user.secretKey.subarray(0, 32));
  const pq = generateKeyPair();
  const pqSignature = pqSign(pqMessage(actionHash), pq.secretKey);

  // 6. verify both signatures off-chain, same checks Orchestrator.processAttestation does
  const adapter = createSolanaAdapter({ rpcUrl, apiKey: "", programId: programId.toBase58() });
  const classicalOk = await adapter.verifyClassicalSignature(
    actionHashBytes,
    classicalSignature,
    user.publicKey.toBase58(),
  );
  const pqOk = pqVerify(pqSignature, pqMessage(actionHash), pq.publicKey);
  console.log("classical signature valid:", classicalOk, "| pq signature valid:", pqOk);
  if (!classicalOk || !pqOk) throw new Error("dual-signature verification failed -- aborting before on-chain write");

  if (await adapter.state.isAttested(actionHash)) {
    throw new Error("actionHash already attested on-chain -- rerun to get a fresh nonce/counter");
  }

  // 7. operator submits the attestation on-chain
  const attestTx = await adapter.state.submitAttestation(actionHash, operator);
  console.log("submit_attestation tx:", attestTx);

  // 8. user withdraws -- program re-derives actionHash itself and checks it against the attestation
  const withdrawTx = await adapter.broadcast.executeVaultAction(
    { vault: vaultPda.toBase58(), amount, nonce: counter },
    user,
  );
  console.log("withdraw tx:", withdrawTx);

  console.log("\nE2E happy path SUCCESS on Solana devnet.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
