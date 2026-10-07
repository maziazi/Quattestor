import { createEvmProvider } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * Arsitektur doc07 §8a: membuktikan klaim "address rentan Shor's algorithm
 * sejak transaksi keluar pertama, bukan sejak dibuat" dengan data on-chain
 * nyata, bukan statistik kutipan. Binary search ke block lampau lewat
 * eth_getTransactionCount -- butuh archive mode (bukan cuma `latest`),
 * itulah yang membuat pilar "Archive Nodes" NOWNodes jadi natural fit di
 * sini, bukan tempelan.
 *
 * Usage: FINDER_ADDRESS=0x... pnpm --filter @quattestor/ops-tools first-exposure-finder
 */

async function nonceAt(
  provider: ReturnType<typeof createEvmProvider>,
  address: string,
  blockNumber: number,
): Promise<number> {
  const hex = await provider.send("eth_getTransactionCount", [address, `0x${blockNumber.toString(16)}`]);
  return Number(BigInt(hex));
}

async function main() {
  const provider = createEvmProvider(requireEnv("ETH_RPC_URL"), requireEnv("NOWNODES_API_KEY"));
  const target = process.env.FINDER_ADDRESS ?? "0x2044e31419185336B83675d8A5094304f07832c5"; // Deployer/User wallet, sudah pasti ada tx keluar di Sepolia

  const latestBlock = await provider.getBlockNumber();
  const latestNonce = await nonceAt(provider, target, latestBlock);
  console.log(`Address: ${target}`);
  console.log(`Nonce saat ini (block ${latestBlock}): ${latestNonce}`);

  if (latestNonce === 0) {
    console.log("Address ini belum pernah mengirim transaksi -- public key belum pernah terekspos on-chain.");
    return;
  }

  // Cari dulu seberapa jauh ke belakang node ini masih punya historical
  // state -- NOWNodes mengiklankan "Archive Nodes" sebagai salah satu dari
  // 6 pilar infrastrukturnya, tapi key hackathon ini ternyata cuma dapat
  // node standar (default pruning window ~128 block, bukan archive
  // sungguhan). Dicek lewat probe, bukan diasumsikan -- pola yang sama
  // dengan temuan Base Sepolia / Solana devnet di PLAN.md.
  let reachable = 0;
  let unreachable = latestBlock;
  while (unreachable - reachable > 1) {
    const depth = Math.floor((reachable + unreachable) / 2);
    try {
      await nonceAt(provider, target, latestBlock - depth);
      reachable = depth;
    } catch {
      unreachable = depth;
    }
  }
  const oldestAccessibleBlock = latestBlock - reachable;
  console.log(`Historical state dapat diakses sampai ~${reachable} block ke belakang (block ${oldestAccessibleBlock}).`);

  const nonceAtOldest = await nonceAt(provider, target, oldestAccessibleBlock);
  if (nonceAtOldest > 0) {
    const oldestBlockInfo = await provider.getBlock(oldestAccessibleBlock);
    const ts = oldestBlockInfo ? new Date(Number(oldestBlockInfo.timestamp) * 1000).toISOString() : "unknown";
    console.log(
      `\nNonce sudah > 0 bahkan di block tertua yang bisa diakses (${oldestAccessibleBlock}, ${ts}) -- exposure sebenarnya terjadi SEBELUM jendela ini. Node/key ini tidak punya archive mode sungguhan, jadi block pasti pertama kali terekspos tidak bisa ditentukan presisi dengan RPC ini.`,
    );
    console.log(
      "=> Yang bisa dipastikan: address ini SUDAH terekspos sejak sebelum block " +
        `${oldestAccessibleBlock} (${ts}). Pembuktian presisi penuh butuh akses archive node sungguhan.`,
    );
    return;
  }

  // Binary search di dalam jendela yang terjangkau saja.
  let lo = oldestAccessibleBlock;
  let hi = latestBlock;
  let calls = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const nonce = await nonceAt(provider, target, mid);
    calls += 1;
    if (nonce > 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  const exposureBlock = lo;
  const block = await provider.getBlock(exposureBlock);
  const timestamp = block ? new Date(Number(block.timestamp) * 1000).toISOString() : "unknown";

  console.log(`\nRPC calls dipakai (binary search): ${calls}`);
  console.log(`Block pertama nonce > 0: ${exposureBlock} (${timestamp})`);
  console.log(
    `=> Public key address ini TEREKSPOS on-chain sejak block ${exposureBlock}. Sejak momen itu -- bukan sejak address dibuat -- address ini rentan "harvest now, decrypt later" lewat Shor's algorithm kalau ada komputer kuantum yang cukup besar.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
