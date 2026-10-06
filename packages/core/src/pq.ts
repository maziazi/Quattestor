import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { randomBytes } from "node:crypto";

/**
 * pq-sidecar, as a reused TS module rather than a separate network process.
 * Same reasoning as the architecture doc's "1 service dipakai semua chain,
 * reuse 100%, 0 perubahan" -- chain adapters import this, never reimplement
 * ML-DSA themselves. Uses @noble/post-quantum (FIPS 204 / ML-DSA-87), one of
 * the standard audited implementations alongside liboqs and PQClean.
 */

export interface PqKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export function generateKeyPair(): PqKeyPair {
  const seed = randomBytes(ml_dsa87.lengths.seed!);
  const { secretKey, publicKey } = ml_dsa87.keygen(seed);
  return { secretKey, publicKey };
}

export function pqSign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_dsa87.sign(message, secretKey);
}

export function pqVerify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  return ml_dsa87.verify(signature, message, publicKey);
}
