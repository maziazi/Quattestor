import {
  type ActionIntentParams,
  type ChainAdapter,
  actionHashBytes,
  computeActionHash,
  pqMessage,
  pqVerify,
} from "@quattestor/core";
import type { PqKeyRegistry } from "./registry.js";

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
}

export class AttestationRejected extends Error {}

export class Orchestrator {
  constructor(
    private readonly adapter: ChainAdapter,
    /** operator's chain-specific signing key, passed through to the adapter */
    private readonly operatorKey: unknown,
    private readonly pqKeyRegistry: PqKeyRegistry,
  ) {}

  async processAttestation(req: AttestRequest): Promise<string> {
    const actionHash = computeActionHash(req.intent);

    const classicalOk = await this.adapter.verifyClassicalSignature(
      actionHashBytes(actionHash),
      req.signatures.classicalSignature,
      req.signatures.claimedIdentity,
    );
    if (!classicalOk) throw new AttestationRejected("classical signature invalid");

    const trustedPqKey = this.pqKeyRegistry.get(req.signatures.claimedIdentity);
    if (!trustedPqKey) {
      throw new AttestationRejected("no registered ML-DSA key for this identity -- call /register first");
    }

    const pqOk = pqVerify(req.signatures.pqSignature, pqMessage(actionHash), trustedPqKey);
    if (!pqOk) throw new AttestationRejected("ML-DSA signature invalid");

    if (await this.adapter.state.isAttested(actionHash)) {
      throw new AttestationRejected("actionHash already attested");
    }

    return this.adapter.state.submitAttestation(actionHash, this.operatorKey);
  }
}
