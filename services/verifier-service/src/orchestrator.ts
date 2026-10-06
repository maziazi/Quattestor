import {
  type ActionIntentParams,
  type ChainAdapter,
  actionHashBytes,
  computeActionHash,
  pqMessage,
  pqVerify,
} from "@quattestor/core";

/**
 * Chain-agnostic core: steps B/C/D of the general flow (architecture doc
 * §2.1). This module never imports ethers, Anchor, or CosmWasm types --
 * everything chain-specific is pushed into the ChainAdapter it is given.
 */

export interface DualSignature {
  classicalSignature: Uint8Array;
  pqSignature: Uint8Array;
  /** address/pubkey the classical signature is supposed to recover to */
  claimedIdentity: string;
}

export interface AttestRequest {
  intent: ActionIntentParams;
  signatures: DualSignature;
  /**
   * MVP gap, flagged honestly rather than assumed: the architecture doc
   * does not specify how a classical identity is bound to a trusted ML-DSA
   * public key (on-chain registry? off-chain allowlist?). Until that's
   * decided (see PLAN.md), the caller self-asserts the pubkey here -- same
   * trust boundary as the rest of the MVP (single centralized Verifier
   * Service, see architecture doc §9.3).
   */
  claimedPqPublicKey: Uint8Array;
}

export class AttestationRejected extends Error {}

export class Orchestrator {
  constructor(
    private readonly adapter: ChainAdapter,
    /** operator's chain-specific signing key, passed through to the adapter */
    private readonly operatorKey: unknown,
  ) {}

  async processAttestation(req: AttestRequest): Promise<string> {
    const actionHash = computeActionHash(req.intent);

    const classicalOk = await this.adapter.verifyClassicalSignature(
      actionHashBytes(actionHash),
      req.signatures.classicalSignature,
      req.signatures.claimedIdentity,
    );
    if (!classicalOk) throw new AttestationRejected("classical signature invalid");

    const pqOk = pqVerify(req.signatures.pqSignature, pqMessage(actionHash), req.claimedPqPublicKey);
    if (!pqOk) throw new AttestationRejected("ML-DSA signature invalid");

    if (await this.adapter.state.isAttested(actionHash)) {
      throw new AttestationRejected("actionHash already attested");
    }

    return this.adapter.state.submitAttestation(actionHash, this.operatorKey);
  }
}
