import { Contract, Wallet } from "ethers";
import { actionHashBytes, computeActionHash, pqMessage, pqSign } from "@quattestor/core";
import { createEvmAdapter, createEvmProvider } from "@quattestor/adapters";
import { loadOrCreatePqKeyPair } from "./pqKeyStore.js";

/**
 * Demo-video CLI for the attack gauntlet (shotlist clips 02, 06, 07, 08).
 * Separate from index.ts (the proven happy-path script) on purpose --
 * zero changes to the already-working dual-sign flow.
 *
 * Usage: MODE=CLASSICAL_ONLY|DOWNGRADE|REPLAY|CROSSCONTEXT node --env-file=../../.env dist/demoAttacks.js
 */

type Mode = "CLASSICAL_ONLY" | "DOWNGRADE" | "REPLAY" | "CROSSCONTEXT";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function main() {
  const mode = requireEnv("MODE") as Mode;
  const amount = BigInt(process.env.AMOUNT_WEI ?? "1000000000000000");
  const chainId = BigInt(requireEnv("CHAIN_ID"));
  const vaultAddress = requireEnv("VAULT_ADDRESS");
  const verifierServiceUrl = process.env.VERIFIER_SERVICE_URL ?? "http://localhost:8787";

  const wallet = new Wallet(requireEnv("USER_PRIVATE_KEY"));
  const pq = loadOrCreatePqKeyPair(process.env.PQ_KEYSTORE_PATH ?? ".quattestor/pq-keypair.json");

  const adapter = createEvmAdapter({
    rpcUrl: requireEnv("ETH_RPC_URL"),
    apiKey: requireEnv("NOWNODES_API_KEY"),
    vaultAddress,
    verifierAddress: requireEnv("VERIFIER_ADDRESS"),
  });

  const nonce = await adapter.state.getCounter(vaultAddress, wallet.address);
  console.log(`=== Quattestor attack demo -- MODE=${mode} ===`);
  console.log("user:", wallet.address);
  console.log("current on-chain nonce:", nonce.toString());

  if (mode === "CLASSICAL_ONLY") {
    console.log("\nAttempt 1 -- withdraw signed with the classical key ONLY.");
    console.log("No /register, no /attest call -- attestation was never submitted.");
    console.log("Forcing a manual gasLimit so this actually broadcasts on-chain");
    console.log("instead of being caught by ethers' pre-flight gas estimation.\n");

    const provider = createEvmProvider(requireEnv("ETH_RPC_URL"), requireEnv("NOWNODES_API_KEY"));
    const userWallet = new Wallet(requireEnv("USER_PRIVATE_KEY"), provider);
    const vault = new Contract(
      vaultAddress,
      ["function withdraw(uint256 amount, uint256 nonce)"],
      userWallet,
    );

    const tx = await vault.withdraw(amount, nonce, { gasLimit: 150000n });
    console.log("broadcast tx hash:", tx.hash);
    console.log("waiting for confirmation...");

    try {
      const receipt = await tx.wait();
      console.log("UNEXPECTED -- mined with status:", receipt?.status);
      process.exitCode = 1;
    } catch (err) {
      const e = err as any;
      console.error("REJECTED on-chain (expected): reverted -- NotAttested()");
      console.error("tx hash:", e?.receipt?.hash ?? tx.hash);
    }
    return;
  }

  const intent = { vault: vaultAddress, chainId, user: wallet.address, amount, nonce };
  const actionHash = computeActionHash(intent);
  const classicalSignature = await wallet.signMessage(actionHashBytes(actionHash));

  console.log("actionHash:", actionHash);

  await postJson(`${verifierServiceUrl}/register`, {
    address: wallet.address,
    pqPublicKey: toHex(pq.publicKey),
  });

  if (mode === "DOWNGRADE") {
    console.log("\nAttack: downgrade -- valid classical signature, corrupted ML-DSA signature.\n");
    const pqSignature = pqSign(pqMessage(actionHash), pq.secretKey);
    pqSignature[0] ^= 0xff;
    pqSignature[1] ^= 0xff;

    const result = await postJson(`${verifierServiceUrl}/attest`, {
      intent: {
        vault: intent.vault,
        chainId: intent.chainId.toString(),
        user: intent.user,
        amount: intent.amount.toString(),
        nonce: intent.nonce.toString(),
      },
      signatures: { classicalSignature, pqSignature: toHex(pqSignature), claimedIdentity: wallet.address },
    });
    console.log(result.ok ? "UNEXPECTED -- accepted:" : "REJECTED (expected):", result.body);
    if (result.ok) process.exitCode = 1;
    return;
  }

  if (mode === "REPLAY") {
    const pqSignature = pqSign(pqMessage(actionHash), pq.secretKey);
    const attestBody = {
      intent: {
        vault: intent.vault,
        chainId: intent.chainId.toString(),
        user: intent.user,
        amount: intent.amount.toString(),
        nonce: intent.nonce.toString(),
      },
      signatures: { classicalSignature, pqSignature: toHex(pqSignature), claimedIdentity: wallet.address },
    };

    console.log("\nFirst attestation -- legitimate, should succeed.\n");
    const first = await postJson(`${verifierServiceUrl}/attest`, attestBody);
    console.log(first.ok ? "attested:" : "FAILED (unexpected):", first.body);
    if (!first.ok) {
      process.exitCode = 1;
      return;
    }

    console.log("\nAttack: replay -- resubmitting the EXACT SAME attestation request again.\n");
    const second = await postJson(`${verifierServiceUrl}/attest`, attestBody);
    console.log(second.ok ? "UNEXPECTED -- accepted:" : "REJECTED (expected):", second.body);
    if (second.ok) process.exitCode = 1;
    return;
  }

  if (mode === "CROSSCONTEXT") {
    console.log("\nAttack: cross-context -- signature computed for THIS chain/vault/nonce,");
    console.log("submitted while CLAIMING a different chainId in the attestation request.\n");
    const pqSignature = pqSign(pqMessage(actionHash), pq.secretKey);
    const forgedChainId = chainId === 11155111n ? 84532n : 11155111n;

    const result = await postJson(`${verifierServiceUrl}/attest`, {
      intent: {
        vault: intent.vault,
        chainId: forgedChainId.toString(),
        user: intent.user,
        amount: intent.amount.toString(),
        nonce: intent.nonce.toString(),
      },
      signatures: { classicalSignature, pqSignature: toHex(pqSignature), claimedIdentity: wallet.address },
    });
    console.log(result.ok ? "UNEXPECTED -- accepted:" : "REJECTED (expected):", result.body);
    if (result.ok) process.exitCode = 1;
    return;
  }

  throw new Error(`unknown MODE: ${mode}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
