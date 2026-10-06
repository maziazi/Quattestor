/**
 * Opsi A dari PLAN.md §3: binding manual identitas klasik <-> ML-DSA pubkey,
 * disimpan in-memory. MVP yang disengaja -- disebut eksplisit sebagai
 * batas kepercayaan di deck, bukan disembunyikan. Registry hilang tiap
 * restart proses; untuk demo itu cukup karena /register dipanggil ulang
 * oleh signer-script di setiap run.
 */
export interface PqKeyRegistry {
  register(address: string, pqPublicKey: Uint8Array): void;
  get(address: string): Uint8Array | undefined;
}

export function createInMemoryPqKeyRegistry(): PqKeyRegistry {
  const map = new Map<string, Uint8Array>();
  return {
    register(address, pqPublicKey) {
      map.set(address.toLowerCase(), pqPublicKey);
    },
    get(address) {
      return map.get(address.toLowerCase());
    },
  };
}
