import { CosmWasmClient, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { Secp256k1, Secp256k1Signature, sha256 } from "@cosmjs/crypto";
import { DirectSecp256k1Wallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import type { ChainAdapter, VaultActionParams } from "@quattestor/core";

/**
 * Osmosis ChainAdapter -- architecture doc §5.3. UNVERIFIED before use: the
 * exact NOWNodes RPC host for Osmosis testnet has never been checked
 * against the dashboard (see PLAN.md §5/§12 -- same category of mistake
 * that happened with Base Sepolia not existing at all).
 *
 * Known identity-model wrinkle, flagged rather than hidden: EVM/Solana
 * identify a user by the same key their classical signature recovers to
 * or verifies against. Cosmos SDK addresses are RIPEMD160(SHA256(pubkey))
 * -- not reversible -- so `claimedIdentity` here must be the base64
 * secp256k1 PUBLIC KEY, not the bech32 address, unlike every other
 * adapter. The orchestrator's PQ-key registry (services/verifier-service)
 * keys on whatever string `claimedIdentity` is, so Osmosis callers must
 * register/attest using the pubkey string consistently -- this is not
 * reconciled with the EVM/Solana address convention yet.
 */

export interface OsmosisAdapterConfig {
  rpcUrl: string;
  apiKey: string;
  vaultContractAddress: string;
  verifierContractAddress: string;
  addressPrefix?: string;
  gasPrice?: string;
}

function endpoint(cfg: OsmosisAdapterConfig) {
  return { url: cfg.rpcUrl, headers: { "api-key": cfg.apiKey } };
}

function actionHashBytes(actionHash: string): Buffer {
  return Buffer.from(actionHash.replace(/^0x/, ""), "hex");
}

export function createOsmosisAdapter(cfg: OsmosisAdapterConfig): ChainAdapter {
  const prefix = cfg.addressPrefix ?? "osmo";
  const gasPrice = GasPrice.fromString(cfg.gasPrice ?? "0.025uosmo");

  return {
    // claimedIdentity: base64 secp256k1 public key -- see module doc above.
    async verifyClassicalSignature(message, signature, claimedIdentity) {
      try {
        const pubkey = Buffer.from(claimedIdentity, "base64");
        const digest = sha256(message);
        const sig = Secp256k1Signature.fromFixedLength(signature);
        return await Secp256k1.verifySignature(sig, digest, pubkey);
      } catch {
        return false;
      }
    },

    state: {
      async getCounter(vaultId, user) {
        const client = await CosmWasmClient.connect(endpoint(cfg));
        const result = await client.queryContractSmart(vaultId || cfg.vaultContractAddress, { nonce: { user } });
        return BigInt(result.nonce);
      },

      async isAttested(actionHash) {
        const client = await CosmWasmClient.connect(endpoint(cfg));
        const result = await client.queryContractSmart(cfg.verifierContractAddress, {
          is_attested: { action_hash: actionHashBytes(actionHash).toString("base64") },
        });
        return Boolean(result.is_attested);
      },

      // operatorKey: raw secp256k1 private key bytes of the trusted operator.
      async submitAttestation(actionHash, operatorKey) {
        const wallet = await DirectSecp256k1Wallet.fromKey(operatorKey as Uint8Array, prefix);
        const [account] = await wallet.getAccounts();
        const client = await SigningCosmWasmClient.connectWithSigner(endpoint(cfg), wallet, { gasPrice });

        const result = await client.execute(
          account.address,
          cfg.verifierContractAddress,
          { submit_attestation: { action_hash: actionHashBytes(actionHash).toString("base64") } },
          "auto",
        );
        return result.transactionHash;
      },
    },

    broadcast: {
      // userKey: raw secp256k1 private key bytes of the demo wallet.
      async executeVaultAction(params: VaultActionParams, userKey) {
        const wallet = await DirectSecp256k1Wallet.fromKey(userKey as Uint8Array, prefix);
        const [account] = await wallet.getAccounts();
        const client = await SigningCosmWasmClient.connectWithSigner(endpoint(cfg), wallet, { gasPrice });

        const result = await client.execute(
          account.address,
          params.vault,
          { withdraw: { amount: params.amount.toString(), nonce: Number(params.nonce) } },
          "auto",
        );
        return result.transactionHash;
      },
    },
  };
}
