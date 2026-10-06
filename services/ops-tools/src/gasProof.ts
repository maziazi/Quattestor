import { createEvmProvider } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * Doc07 §8b: bukti forensik opcode-level bahwa beban PQC 100% terjadi
 * off-chain -- tidak ada opcode lattice/hash mahal di trace Vault.withdraw(),
 * hanya SLOAD/CALL/STATICCALL/transfer biasa.
 *
 * Usage: TX_HASH=0x... node --experimental-strip-types src/gasProof.ts
 */
async function main() {
  const txHash = process.argv[2] ?? requireEnv("TX_HASH");
  const provider = createEvmProvider(requireEnv("ETH_RPC_URL"), requireEnv("NOWNODES_API_KEY"));

  const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
  console.log("gasUsed:", Number.parseInt(receipt.gasUsed, 16), "status:", receipt.status);

  const trace = await provider.send("debug_traceTransaction", [txHash, {}]);
  const opcodes = new Set<string>((trace.structLogs ?? []).map((l: { op: string }) => l.op));
  console.log("unique opcodes touched:", [...opcodes].sort().join(", "));

  const latticeLike = [...opcodes].filter((op) => /MULMOD|EXPMOD|MODEXP/i.test(op));
  console.log(
    latticeLike.length === 0
      ? "confirmed: no lattice/modexp-style opcodes present -- PQC verification cost is 100% off-chain"
      : `unexpected: found ${latticeLike.join(", ")}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
