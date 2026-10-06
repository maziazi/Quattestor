import { Wallet } from "ethers";
import { actionHashBytes, computeActionHash, pqMessage, pqSign } from "@quattestor/core";
import { createEvmAdapter } from "@quattestor/adapters";
import { loadOrCreatePqKeyPair } from "./pqKeyStore.js";

/**
 * CLI demo of the full user-side happy path (architecture doc §2.1 steps
 * A/B): compute Action Intent, dual-sign it off-chain (classical + ML-DSA),
 * send both to verifier-service, then (optionally) broadcast the withdraw.
 *
 * Usage: AMOUNT_WEI=1000000000000000 node --experimental-strip-types src/index.ts
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

async function main() {
  const amount = BigInt(process.env.AMOUNT_WEI ?? "1000000000000000"); // default 0.001
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

  const intent = { vault: vaultAddress, chainId, user: wallet.address, amount, nonce };
  const actionHash = computeActionHash(intent);
  console.log("actionHash:", actionHash);

  const classicalSignature = await wallet.signMessage(actionHashBytes(actionHash));
  const pqSignature = pqSign(pqMessage(actionHash), pq.secretKey);

  const res = await fetch(`${verifierServiceUrl}/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: {
        vault: vaultAddress,
        chainId: chainId.toString(),
        user: wallet.address,
        amount: amount.toString(),
        nonce: nonce.toString(),
      },
      signatures: {
        classicalSignature,
        pqSignature: toHex(pqSignature),
        claimedIdentity: wallet.address,
      },
      claimedPqPublicKey: toHex(pq.publicKey),
    }),
  });

  const attestResult = await res.json();
  if (!res.ok) {
    console.error("attestation rejected:", attestResult);
    process.exitCode = 1;
    return;
  }
  console.log("attestation tx:", attestResult.txHash);

  if (process.env.SKIP_WITHDRAW === "1") return;

  const withdrawTxHash = await adapter.broadcast.executeVaultAction(
    { vault: vaultAddress, amount, nonce },
    requireEnv("USER_PRIVATE_KEY"),
  );
  console.log("withdraw tx:", withdrawTxHash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
