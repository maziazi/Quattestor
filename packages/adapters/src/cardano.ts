import { readFileSync } from "node:fs";
import {
  Blockfrost,
  Constr,
  Data,
  Koios,
  Lucid,
  type MintingPolicy,
  type Provider,
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
  /**
   * Which Cardano query API `rpcUrl` speaks. Default `"blockfrost"` --
   * NOWNodes' mainnet endpoint (`ada-blockfrost.nownodes.io`) is
   * Blockfrost-compatible. Their preprod testnet endpoint
   * (`ada-testnet.nownodes.io`), discovered later, is Koios-compatible
   * instead (confirmed live: `/api/v1/genesis` reports `networkmagic: "1"`
   * = preprod) -- a completely different REST shape, so the provider
   * must be told which one it's talking to.
   */
  providerKind?: "blockfrost" | "koios";
}

export interface CardanoOperatorKey {
  /** bech32 `ed25519_sk...` private key, OR a 12/24-word seed phrase --
   * see `selectWalletFromSecret` below. Wallet apps (Eternl, Nami, Lace)
   * export seed phrases, not raw keys, so both forms are accepted. */
  privateKey: string;
  recipientAddress: string;
}

/**
 * Accepts either a bech32 `ed25519_sk...` private key or a 12/24-word
 * seed phrase -- the two forms Lucid Evolution's `selectWallet` supports,
 * and the two forms a real user is likely to have: `cardano-generate-wallet`
 * produces the former, mainstream wallet apps (Eternl/Nami/Lace) only ever
 * export the latter.
 */
export function selectWalletFromSecret(lucid: Awaited<ReturnType<typeof Lucid>>, secret: string): void {
  const trimmed = secret.trim();
  if (trimmed.startsWith("ed25519_sk")) {
    lucid.selectWallet.fromPrivateKey(trimmed);
  } else {
    lucid.selectWallet.fromSeed(trimmed);
  }
}

/**
 * Lucid Evolution's `Blockfrost` provider always sends `project_id`
 * (standard Blockfrost auth) -- confirmed by a live call that NOWNodes'
 * "Blockfrost-compatible" Cardano endpoint rejects that with "Unknown
 * API_key" and wants their own `api-key` header instead, same as every
 * other chain in this repo. `fetch` is `private` in Blockfrost's *type*
 * declarations but a plain method at runtime (no JS `#` privacy), so the
 * instance's own `fetch` property can be monkey-patched directly instead
 * of reimplementing the entire `Provider` interface from scratch.
 */
export function createNowNodesBlockfrostProvider(url: string, apiKey: string): Blockfrost {
  const provider = new Blockfrost(url, apiKey);
  const providerAny = provider as unknown as { fetch: (input: unknown, init?: RequestInit) => Promise<Response> };
  const originalFetch = providerAny.fetch.bind(provider);
  providerAny.fetch = (input: unknown, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("api-key", apiKey);
    return originalFetch(input, { ...init, headers });
  };
  return provider;
}

/**
 * Lucid Evolution's `Koios` provider has no equivalent instance `fetch`
 * hook to monkey-patch (headers are built inline per-method as
 * `Authorization: Bearer <token>` and sent through `@effect/platform`'s
 * `FetchHttpClient`, which ultimately calls the global `fetch`). So the
 * `api-key` header is injected at that global level instead, scoped to
 * requests whose host matches `url` so unrelated `fetch` calls elsewhere
 * in the process are untouched.
 */
export function createNowNodesKoiosProvider(url: string, apiKey: string): Koios {
  const host = new URL(url).host;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const target = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    if (new URL(target).host !== host) return original(input, init);
    const headers = new Headers(init.headers);
    headers.set("api-key", apiKey);
    return original(input, { ...init, headers });
  }) as typeof fetch;
  return new Koios(url);
}

const KOIOS_PUBLIC_SUBMIT_URL: Record<CardanoAdapterConfig["network"], string> = {
  Mainnet: "https://api.koios.rest/api/v1/submittx",
  Preprod: "https://preprod.koios.rest/api/v1/submittx",
  Preview: "https://preview.koios.rest/api/v1/submittx",
};

/**
 * NOWNodes' Cardano `/tx/submit` (both mainnet and the preprod testnet
 * endpoint) returns a raw, non-Blockfrost server crash --
 * `{"error":"Cannot read properties of undefined (reading 'data')"}` --
 * confirmed by posting a real, validly-built-and-signed CBOR transaction
 * directly (not a malformed probe), ruling out a client-side formatting
 * issue. The exact same transaction submitted successfully (202, real
 * tx hash, confirmed on-chain) through Koios's free public `/submittx`
 * instead. All *reads* through NOWNodes are unaffected and still used --
 * this only patches the one broken write path, swapping it for Koios's
 * public submit endpoint (no API key needed for that specific call).
 */
function patchSubmitTxViaPublicKoios<P extends { submitTx(tx: string): Promise<string> }>(
  provider: P,
  network: CardanoAdapterConfig["network"],
): P {
  const submitUrl = KOIOS_PUBLIC_SUBMIT_URL[network];
  provider.submitTx = async (tx: string): Promise<string> => {
    const res = await fetch(submitUrl, {
      method: "POST",
      headers: { "content-type": "application/cbor" },
      body: Buffer.from(tx, "hex"),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Koios submitTx failed (${res.status}): ${text}`);
    return JSON.parse(text) as string;
  };
  return provider;
}

export function createNowNodesCardanoProvider(cfg: CardanoAdapterConfig): Provider {
  const provider =
    cfg.providerKind === "koios"
      ? createNowNodesKoiosProvider(cfg.rpcUrl, cfg.apiKey)
      : createNowNodesBlockfrostProvider(cfg.rpcUrl, cfg.apiKey);
  return patchSubmitTxViaPublicKoios(provider, cfg.network);
}

/**
 * Exposes the same vault-identity derivation `createCardanoAdapter` and
 * `bootstrapVault` already do internally -- needed by anything that must
 * independently compute an `actionHash` the way `vault.ak` does (vault's
 * own script hash + attestation policy id), e.g. a Cardano e2e demo script
 * that has to attest *before* a withdraw can read the hash back off-chain.
 * No network/provider access, pure local derivation from the compiled
 * `plutus.json` + trusted operator pkh.
 */
export function loadCardanoVaultIdentifiers(cfg: CardanoAdapterConfig): {
  vaultAddress: string;
  vaultScriptHash: Uint8Array;
  policyId: Uint8Array;
} {
  const { policyId, spendingValidator } = loadScripts(cfg.plutusBlueprintPath, cfg.trustedOperatorPkh);
  return {
    vaultAddress: validatorToAddress(cfg.network, spendingValidator),
    vaultScriptHash: Uint8Array.from(Buffer.from(validatorToScriptHash(spendingValidator), "hex")),
    policyId: Uint8Array.from(Buffer.from(policyId, "hex")),
  };
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
  const provider = createNowNodesCardanoProvider(cfg);
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
        selectWalletFromSecret(lucid, privateKey);

        const unit = toUnit(policyId, actionHash.replace(/^0x/, ""));
        const tx = await lucid
          .newTx()
          .mintAssets({ [unit]: 1n }, Data.void())
          .attach.MintingPolicy(mintingPolicy)
          // verifier.ak's can_mint checks `extra_signatories` (the tx's
          // declared required-signer list), NOT the witness set -- signing
          // with the operator's wallet alone does not add it there. Must
          // be declared explicitly or the script sees an empty list and
          // fails ("validator crashed"), confirmed by a real on-chain run.
          .addSignerKey(cfg.trustedOperatorPkh)
          .pay.ToAddress(recipientAddress, { [unit]: 1n })
          .complete();

        const signed = await tx.sign.withWallet().complete();
        return signed.submit();
      },
    },

    broadcast: {
      async executeVaultAction(params: VaultActionParams, userKey) {
        selectWalletFromSecret(lucid, userKey as string);
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
          // Same extra_signatories gap as submitAttestation above --
          // vault.ak's can_withdraw checks `list.has(self.extra_signatories,
          // owner)`, which stays empty unless declared explicitly.
          .addSignerKey(ownerPkhHex)
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
 * `ownerSecret` (bech32 private key OR seed phrase, see
 * `selectWalletFromSecret`) both owns the resulting vault AND pays for
 * this bootstrap tx -- the vault is funded with `initialLovelace`,
 * withdrawable later via `broadcast.executeVaultAction` once a matching
 * attestation exists.
 */
export async function bootstrapVault(
  cfg: CardanoAdapterConfig,
  ownerSecret: string,
  initialLovelace: bigint,
): Promise<string> {
  const provider = createNowNodesCardanoProvider(cfg);
  const lucid = await Lucid(provider, cfg.network);
  const { spendingValidator } = loadScripts(cfg.plutusBlueprintPath, cfg.trustedOperatorPkh);
  const vaultAddress = validatorToAddress(cfg.network, spendingValidator);

  selectWalletFromSecret(lucid, ownerSecret);
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
