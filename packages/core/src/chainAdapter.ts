export interface VaultActionParams {
  vault: string;
  amount: bigint;
  nonce: bigint;
}

/**
 * The 3 things that differ per chain (§4 of the architecture doc), locked
 * into one interface. The orchestrator (orchestrator.ts in verifier-service)
 * dispatches through this and never branches on chain type itself -- adding
 * a 6th chain means writing one new file that implements this interface,
 * zero changes to core logic.
 */
export interface ChainAdapter {
  verifyClassicalSignature(
    message: Uint8Array,
    signature: Uint8Array,
    claimedIdentity: string,
  ): Promise<boolean>;

  state: {
    getCounter(vaultId: string, user: string): Promise<bigint>;
    isAttested(actionHash: string): Promise<boolean>;
    submitAttestation(actionHash: string, operatorKey: unknown): Promise<string>;
  };

  broadcast: {
    executeVaultAction(params: VaultActionParams, userKey: unknown): Promise<string>;
  };
}
