import { PrivateKey } from "@anastasia-labs/cardano-multiplatform-lib-nodejs";
import { Lucid, getAddressDetails } from "@lucid-evolution/lucid";
import {
  type CardanoAdapterConfig,
  type CardanoOperatorKey,
  computeCardanoActionHash,
  createCardanoAdapter,
  createNowNodesCardanoProvider,
  loadCardanoVaultIdentifiers,
  selectWalletFromSecret,
} from "@quattestor/adapters";
import { generateKeyPair, pqMessage, pqSign, pqVerify } from "@quattestor/core";
import { requireEnv } from "./env.js";

/**
 * E2E happy-path demo for Cardano (GO/NO-GO, PLAN.md fase Cardano Preprod).
 * Same reason as solanaE2E.ts for not going through verifier-service's HTTP
 * API: Orchestrator.processAttestation hashes with `computeActionHash`
 * (Solidity ABI encoding over vault/chainId/user/amount/nonce), which has
 * no Cardano equivalent -- there's no chainId, and "nonce" is the vault
 * UTxO's own `counter` field read back from chain state, not a caller
 * input. This script inlines the same dual-sign + verify steps using
 * `computeCardanoActionHash` instead.
 *
 * Precondition: `cardano-bootstrap-vault` must already have been run for
 * this User (creates the first Vault UTxO) -- this script only attests
 * and withdraws, it doesn't create the vault.
 *
 * Classical signing needs the User's raw Ed25519 keypair, which Lucid's
 * wallet API doesn't expose directly (it only signs whole transactions).
 * `@anastasia-labs/cardano-multiplatform-lib-nodejs` (CML, already a
 * transitive dependency of Lucid Evolution) decodes the bech32
 * `ed25519_sk...` secret into a raw key CML can sign with directly --
 * `PrivateKey.sign()` output is verified the same way `cardano.ts`'s
 * `verifyClassicalSignature` already does, via @noble/curves/ed25519.
 */

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

async function main() {
  const cfg: CardanoAdapterConfig = {
    rpcUrl: requireEnv("CARDANO_RPC_URL"),
    apiKey: requireEnv("NOWNODES_API_KEY"),
    network: (process.env.CARDANO_NETWORK as CardanoAdapterConfig["network"]) ?? "Mainnet",
    plutusBlueprintPath: requireEnv("CARDANO_PLUTUS_BLUEPRINT_PATH"),
    trustedOperatorPkh: requireEnv("CARDANO_TRUSTED_OPERATOR_PKH"),
    providerKind: (process.env.CARDANO_PROVIDER_KIND as CardanoAdapterConfig["providerKind"]) ?? "blockfrost",
  };

  const operatorSkey = requireEnv("CARDANO_OPERATOR_SKEY");
  const userSkey = requireEnv("CARDANO_USER_SKEY");
  const amount = BigInt(process.env.CARDANO_AMOUNT_LOVELACE ?? "1000000"); // default 1 ADA

  // Separate, throwaway Lucid instance purely for address/pkh resolution --
  // createCardanoAdapter() keeps its own internal one, encapsulated.
  const provider = createNowNodesCardanoProvider(cfg);
  const lucid = await Lucid(provider, cfg.network);
  selectWalletFromSecret(lucid, userSkey);
  const userAddress = await lucid.wallet().address();
  const userPkhHex = getAddressDetails(userAddress).paymentCredential?.hash;
  if (!userPkhHex) throw new Error("could not resolve payment key hash from Cardano User address");

  const { vaultScriptHash, policyId } = loadCardanoVaultIdentifiers(cfg);
  const adapter = await createCardanoAdapter(cfg);

  // 1. counter from the existing Vault UTxO (created by cardano-bootstrap-vault)
  const counter = await adapter.state.getCounter("", userPkhHex);
  console.log("current vault counter:", counter);

  // 2. compute actionHash -- must match compute_action_hash in vault.ak exactly
  const ownerPkhBytes = Uint8Array.from(Buffer.from(userPkhHex, "hex"));
  const actionHashRaw = computeCardanoActionHash(vaultScriptHash, policyId, ownerPkhBytes, amount, counter);
  const actionHash = toHex(actionHashRaw);
  console.log("actionHash:", actionHash);

  // 3. dual-sign off-chain (classical ed25519 via CML + ML-DSA-87), same pattern as signer-script
  const userPrivKey = PrivateKey.from_bech32(userSkey);
  const userPubKeyHex = Buffer.from(userPrivKey.to_public().to_raw_bytes()).toString("hex");
  const classicalSignature = userPrivKey.sign(actionHashRaw).to_raw_bytes();
  const pq = generateKeyPair();
  const pqSignature = pqSign(pqMessage(actionHash), pq.secretKey);

  // 4. verify both signatures off-chain, same checks Orchestrator.processAttestation does
  const classicalOk = await adapter.verifyClassicalSignature(actionHashRaw, classicalSignature, userPubKeyHex);
  const pqOk = pqVerify(pqSignature, pqMessage(actionHash), pq.publicKey);
  console.log("classical signature valid:", classicalOk, "| pq signature valid:", pqOk);
  if (!classicalOk || !pqOk) throw new Error("dual-signature verification failed -- aborting before on-chain write");

  if (await adapter.state.isAttested(actionHash)) {
    throw new Error("actionHash already attested on-chain -- bump CARDANO_AMOUNT_LOVELACE or wait for a new counter");
  }

  // 5. operator mints the attestation NFT, sent to the User's address (eUTXO
  //    quirk, see PLAN.md §3c: the User must hold it to withdraw unassisted)
  const operatorKey: CardanoOperatorKey = { privateKey: operatorSkey, recipientAddress: userAddress };
  const attestTx = await adapter.state.submitAttestation(actionHash, operatorKey);
  console.log("submitAttestation tx:", attestTx);

  // 6. user withdraws -- adapter re-derives counter/actionHash itself from
  //    the on-chain Vault UTxO and checks it against the attestation NFT
  const withdrawTx = await adapter.broadcast.executeVaultAction({ vault: userAddress, amount, nonce: counter }, userSkey);
  console.log("withdraw tx:", withdrawTx);

  console.log(`\nE2E happy path SUCCESS on Cardano ${cfg.network}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
