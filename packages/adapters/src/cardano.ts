import { readFileSync } from "node:fs";
import {
  Blockfrost,
  Constr,
  Data,
  Lucid,
  type MintingPolicy,
  type SpendingValidator,
  applyParamsToScript,
  getAddressDetails,
  mintingPolicyToId,
  toUnit,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ChainAdapter, VaultActionParams } from "@quattestor/core";

/**
 * Cardano ChainAdapter -- eUTXO equivalent of the architecture doc's §5
 * Vault/Verifier pair (see contracts/cardano/validators/{vault,verifier}.ak
 * for the on-chain side and why the design differs structurally: no
 * persistent mapping/account exists in eUTXO, so "attestation" is an NFT
 * minted under a policy gated to the trusted operator, and "replay
 * protection" comes from the ledger's own one-time-spendable UTXO rule
 * rather than a nonce check).
 *
 * Two deviations from the EVM/Solana adapters' calling convention, both
 * forced by the eUTXO model and documented rather than hidden:
 *
 * 1. `claimedIdentity` here must be a hex Ed25519 PUBLIC KEY, not an
 *    address -- same category of wrinkle as the (now-removed) Osmosis
 *    adapter had, for the same reason: you cannot verify a signature
 *    against a hash of the key.
 * 2. `state.submitAttestation`'s `operatorKey` parameter is a
 *    `CardanoOperatorKey` object `{ privateKey, recipientAddress }`, not a
 *    bare key -- minting the attestation NFT must also decide which
 *    address receives it (the user's), so the user later holds it as a
 *    freely-spendable UTXO without needing the operator to co-sign the
 *    withdraw. The shared `ChainAdapter` interface types this parameter as
 *    `unknown` precisely to allow this per-chain variance.
 */

export interface CardanoAdapterConfig {
  rpcUrl: string;
  apiKey: string;
  network: "Mainnet" | "Preprod" | "Preview";
  /** Path to contracts/cardano/plutus.json, produced by `aiken build`. */
  plutusBlueprintPath: string;
  /** hex VerificationKeyHash of the trusted operator. */
  trustedOperatorPkh: string;
}

export interface CardanoOperatorKey {
  /** bech32 `ed25519_sk...` */
  privateKey: string;
  recipientAddress: string;
}

function loadScripts(blueprintPath: string, trustedOperatorPkh: string) {
  const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8"));
  const find = (title: string) => {
    const entry = blueprint.validators.find((v: { title: string }) => v.title === title);
    if (!entry) throw new Error(`validator "${title}" not found in plutus.json`);
    return entry.compiledCode as string;
  };

  const mintingPolicy: MintingPolicy = {
    type: "PlutusV3",
    script: applyParamsToScript(find("verifier.verifier.mint"), [trustedOperatorPkh]),
  };
  const policyId = mintingPolicyToId(mintingPolicy);

  const spendingValidator: SpendingValidator = {
    type: "PlutusV3",
    script: applyParamsToScript(find("vault.vault.spend"), [policyId]),
  };

  return { mintingPolicy, policyId, spendingValidator };
}

function encodeVaultDatum(ownerPkh: string, counter: bigint): string {
  return Data.to(new Constr(0, [ownerPkh, counter]));
}

function encodeWithdrawRedeemer(amount: bigint, actionHashHex: string): string {
  return Data.to(new Constr(0, [amount, actionHashHex]));
}

function decodeVaultDatum(datumHex: string): { owner: string; counter: bigint } {
  const parsed = Data.from(datumHex) as Constr<Data>;
  return { owner: parsed.fields[0] as string, counter: parsed.fields[1] as bigint };
}

/**
 * Same 5-logical-input keccak256 formula as every other chain here. Must
 * match `compute_action_hash` in contracts/cardano/validators/vault.ak
 * byte-for-byte (own script hash, attestation policy id, owner pkh, amount
 * as 8-byte big-endian, counter as 8-byte big-endian).
 */
export function computeCardanoActionHash(
  vaultScriptHash: Uint8Array,
  attestationPolicyId: Uint8Array,
  ownerPkh: Uint8Array,
  amount: bigint,
  counter: bigint,
): Uint8Array {
  const amountBe = Buffer.alloc(8);
  amountBe.writeBigUInt64BE(amount);
  const counterBe = Buffer.alloc(8);
  counterBe.writeBigUInt64BE(counter);
  return keccak_256(Buffer.concat([vaultScriptHash, attestationPolicyId, ownerPkh, amountBe, counterBe]));
}

export async function createCardanoAdapter(cfg: CardanoAdapterConfig): Promise<ChainAdapter> {
  const provider = new Blockfrost(cfg.rpcUrl, cfg.apiKey);
  const lucid = await Lucid(provider, cfg.network);
  const { mintingPolicy, policyId, spendingValidator } = loadScripts(
    cfg.plutusBlueprintPath,
    cfg.trustedOperatorPkh,
  );
  const vaultAddress = validatorToAddress(cfg.network, spendingValidator);
  const vaultScriptHash = Buffer.from(validatorToScriptHash(spendingValidator), "hex");
  const policyIdBytes = Buffer.from(policyId, "hex");

  return {
    async verifyClassicalSignature(message, signature, claimedIdentity) {
      try {
        return ed25519.verify(signature, message, Buffer.from(claimedIdentity, "hex"));
      } catch {
        return false;
      }
    },

    state: {
      async getCounter(vaultId, user) {
        const utxos = await lucid.utxosAt(vaultId || vaultAddress);
        for (const utxo of utxos) {
          if (!utxo.datum) continue;
          const { owner, counter } = decodeVaultDatum(utxo.datum);
          if (owner.toLowerCase() === user.toLowerCase()) return counter;
        }
        return 0n;
      },

      async isAttested(actionHash) {
        const unit = toUnit(policyId, actionHash.replace(/^0x/, ""));
        try {
          await lucid.utxoByUnit(unit);
          return true;
        } catch {
          return false;
        }
      },

      async submitAttestation(actionHash, operatorKey) {
        const { privateKey, recipientAddress } = operatorKey as CardanoOperatorKey;
        lucid.selectWallet.fromPrivateKey(privateKey);

        const unit = toUnit(policyId, actionHash.replace(/^0x/, ""));
        const tx = await lucid
          .newTx()
          .mintAssets({ [unit]: 1n }, Data.void())
          .attach.MintingPolicy(mintingPolicy)
          .pay.ToAddress(recipientAddress, { [unit]: 1n })
          .complete();

        const signed = await tx.sign.withWallet().complete();
        return signed.submit();
      },
    },

    broadcast: {
      async executeVaultAction(params: VaultActionParams, userKey) {
        const privateKey = userKey as string;
        lucid.selectWallet.fromPrivateKey(privateKey);
        const userAddress = await lucid.wallet().address();
        const ownerPkhHex = getAddressDetails(userAddress).paymentCredential?.hash;
        if (!ownerPkhHex) throw new Error("could not resolve payment key hash from Cardano address");

        const vaultUtxos = await lucid.utxosAt(vaultAddress);
        const vaultUtxo = vaultUtxos.find(
          (u) => u.datum && decodeVaultDatum(u.datum).owner.toLowerCase() === ownerPkhHex.toLowerCase(),
        );
        if (!vaultUtxo?.datum) throw new Error("no vault UTxO found for this user");
        const { counter } = decodeVaultDatum(vaultUtxo.datum);

        const actionHash = computeCardanoActionHash(
          vaultScriptHash,
          policyIdBytes,
          Buffer.from(ownerPkhHex, "hex"),
          params.amount,
          counter,
        );
        const actionHashHex = Buffer.from(actionHash).toString("hex");
        const unit = toUnit(policyId, actionHashHex);
        const attestationUtxo = await lucid.utxoByUnit(unit);

        const tx = await lucid
          .newTx()
          .collectFrom([vaultUtxo], encodeWithdrawRedeemer(params.amount, actionHashHex))
          .collectFrom([attestationUtxo])
          .mintAssets({ [unit]: -1n }, Data.void())
          .attach.SpendingValidator(spendingValidator)
          .attach.MintingPolicy(mintingPolicy)
          .pay.ToAddressWithData(
            vaultAddress,
            { kind: "inline", value: encodeVaultDatum(ownerPkhHex, counter + 1n) },
            { lovelace: vaultUtxo.assets.lovelace - params.amount },
          )
          .pay.ToAddress(userAddress, { lovelace: params.amount })
          .complete();

        const signed = await tx.sign.withWallet().complete();
        return signed.submit();
      },
    },
  };
}

/**
 * Creates the first Vault UTxO for a given owner -- the eUTXO equivalent of
 * EVM's `Deploy.s.sol` / Solana's `initialize_vault` instruction. Nothing
 * else in this adapter can do this: `state`/`broadcast` only read or spend
 * an existing Vault UTxO, none of them create one from scratch.
 *
 * `ownerSkey` both owns the resulting vault AND pays for this bootstrap tx
 * -- the vault is funded with `initialLovelace`, withdrawable later via
 * `broadcast.executeVaultAction` once a matching attestation exists.
 */
export async function bootstrapVault(
  cfg: CardanoAdapterConfig,
  ownerSkey: string,
  initialLovelace: bigint,
): Promise<string> {
  const provider = new Blockfrost(cfg.rpcUrl, cfg.apiKey);
  const lucid = await Lucid(provider, cfg.network);
  const { spendingValidator } = loadScripts(cfg.plutusBlueprintPath, cfg.trustedOperatorPkh);
  const vaultAddress = validatorToAddress(cfg.network, spendingValidator);

  lucid.selectWallet.fromPrivateKey(ownerSkey);
  const ownerAddress = await lucid.wallet().address();
  const ownerPkh = getAddressDetails(ownerAddress).paymentCredential?.hash;
  if (!ownerPkh) throw new Error("could not resolve payment key hash from Cardano address");

  const tx = await lucid
    .newTx()
    .pay.ToAddressWithData(
      vaultAddress,
      { kind: "inline", value: encodeVaultDatum(ownerPkh, 0n) },
      { lovelace: initialLovelace },
    )
    .complete();

  const signed = await tx.sign.withWallet().complete();
  return signed.submit();
}
