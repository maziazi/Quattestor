import {
  Contract,
  FetchRequest,
  JsonRpcProvider,
  SigningKey,
  Wallet,
  concat,
  hexlify,
  verifyMessage,
} from "ethers";
import type { ChainAdapter, VaultActionParams } from "@quattestor/core";

/**
 * EVM ChainAdapter -- reused verbatim for Ethereum Sepolia, Base and
 * Arbitrum. Only `rpcUrl`/`vaultAddress`/`verifierAddress` change between
 * chains; nothing here branches on which EVM chain it is talking to.
 */

const VAULT_ABI = [
  "function nonces(address) view returns (uint256)",
  "function withdraw(uint256 amount, uint256 nonce)",
];

const VERIFIER_ABI = [
  "function isAttested(bytes32 actionHash) view returns (bool)",
  "function submitAttestation(bytes32 actionHash, bytes operatorSig)",
];

export interface EvmAdapterConfig {
  rpcUrl: string;
  apiKey: string;
  vaultAddress: string;
  verifierAddress: string;
}

/** NOWNodes auth: `api-key` header on every JSON-RPC POST. */
export function createEvmProvider(rpcUrl: string, apiKey: string): JsonRpcProvider {
  const req = new FetchRequest(rpcUrl);
  req.setHeader("api-key", apiKey);
  return new JsonRpcProvider(req);
}

export function createEvmAdapter(cfg: EvmAdapterConfig): ChainAdapter {
  const provider = createEvmProvider(cfg.rpcUrl, cfg.apiKey);
  const vault = new Contract(cfg.vaultAddress, VAULT_ABI, provider);
  const verifier = new Contract(cfg.verifierAddress, VERIFIER_ABI, provider);

  return {
    async verifyClassicalSignature(message, signature, claimedIdentity) {
      try {
        const recovered = verifyMessage(message, hexlify(signature));
        return recovered.toLowerCase() === claimedIdentity.toLowerCase();
      } catch {
        return false;
      }
    },

    state: {
      async getCounter(_vaultId, user) {
        return (await vault.nonces(user)) as bigint;
      },

      async isAttested(actionHash) {
        return (await verifier.isAttested(actionHash)) as boolean;
      },

      // operatorKey: 0x-prefixed private key hex. Signs the raw actionHash
      // digest (no EIP-191 prefix) to match Verifier.sol's plain ecrecover,
      // then broadcasts the tx itself (acts as the relayer too).
      async submitAttestation(actionHash, operatorKey) {
        const signingKey = new SigningKey(operatorKey as string);
        const sig = signingKey.sign(actionHash);
        const operatorSig = concat([sig.r, sig.s, hexlify(new Uint8Array([sig.v]))]);

        const wallet = new Wallet(operatorKey as string, provider);
        const connected = verifier.connect(wallet) as Contract;
        const tx = await connected.submitAttestation(actionHash, operatorSig);
        await tx.wait();
        return tx.hash as string;
      },
    },

    broadcast: {
      // userKey: 0x-prefixed private key hex of the demo wallet. In a real
      // dApp this tx would come from the user's own wallet (Rabby etc.);
      // signer-script drives it directly here for the hackathon demo.
      async executeVaultAction(params: VaultActionParams, userKey) {
        const wallet = new Wallet(userKey as string, provider);
        const connected = vault.connect(wallet) as Contract;
        const tx = await connected.withdraw(params.amount, params.nonce);
        await tx.wait();
        return tx.hash as string;
      },
    },
  };
}
