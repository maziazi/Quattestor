import { solidityPackedKeccak256 } from "ethers";

/** Must match `Vault.sol::withdraw` exactly -- same formula on every chain. */
export interface ActionIntentParams {
  vault: string;
  chainId: bigint | number;
  user: string;
  amount: bigint;
  nonce: bigint;
}

export const DOMAIN_TAG = "quattestor/v1";

/**
 * Canonical actionHash. Encoding mechanics differ per VM (abi.encodePacked on
 * EVM, Borsh on Solana, CosmWasm JSON on Osmosis) but the inputs and keccak256
 * are identical everywhere -- this is what makes "1 identity across 5 chains"
 * literally true rather than a marketing claim.
 */
export function computeActionHash(p: ActionIntentParams): string {
  return solidityPackedKeccak256(
    ["address", "uint256", "address", "uint256", "uint256"],
    [p.vault, p.chainId, p.user, p.amount, p.nonce],
  );
}

/** Domain-separated message fed to ML-DSA sign/verify -- never raw actionHash. */
export function pqMessage(actionHash: string): Uint8Array {
  const tag = new TextEncoder().encode(DOMAIN_TAG);
  const hash = actionHashBytes(actionHash);
  return Uint8Array.from(Buffer.concat([tag, hash]));
}

/** actionHash as raw 32 bytes -- what the classical key signs, per chain's own encoding. */
export function actionHashBytes(actionHash: string): Uint8Array {
  return Uint8Array.from(Buffer.from(actionHash.slice(2), "hex"));
}
