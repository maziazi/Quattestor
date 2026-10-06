import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateKeyPair, type PqKeyPair } from "@quattestor/core";

/**
 * Local-only ML-DSA keypair for the demo user. The secret key never leaves
 * this process (architecture doc §9.2: "private key tidak pernah meninggalkan
 * device penandatangan") -- this file is the device.
 */
export function loadOrCreatePqKeyPair(path: string): PqKeyPair {
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      secretKey: Uint8Array.from(Buffer.from(raw.secretKey, "hex")),
      publicKey: Uint8Array.from(Buffer.from(raw.publicKey, "hex")),
    };
  }

  const pair = generateKeyPair();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      secretKey: Buffer.from(pair.secretKey).toString("hex"),
      publicKey: Buffer.from(pair.publicKey).toString("hex"),
    }),
  );
  return pair;
}
