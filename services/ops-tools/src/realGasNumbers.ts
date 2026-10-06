import { createEvmProvider } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * Doc §7.3: ganti tabel gas fee ilustratif dengan angka nyata dari
 * eth_getTransactionReceipt + eth_gasPrice, sekali per chain (ETH Sepolia /
 * Base / Arbitrum -- jalankan ulang dengan ETH_RPC_URL berbeda per chain).
 *
 * Usage: ATTEST_TX_HASH=0x.. WITHDRAW_TX_HASH=0x.. node --experimental-strip-types src/realGasNumbers.ts
 */
async function main() {
  const provider = createEvmProvider(requireEnv("ETH_RPC_URL"), requireEnv("NOWNODES_API_KEY"));
  const gasPrice = BigInt(await provider.send("eth_gasPrice", []));

  const entries: [string, string][] = [
    ["submitAttestation", requireEnv("ATTEST_TX_HASH")],
    ["withdraw", requireEnv("WITHDRAW_TX_HASH")],
  ];

  for (const [label, hash] of entries) {
    const receipt = await provider.send("eth_getTransactionReceipt", [hash]);
    const gasUsed = BigInt(receipt.gasUsed);
    const costWei = gasUsed * gasPrice;
    console.log(
      `${label}: gasUsed=${gasUsed} gasPrice=${gasPrice} wei -> cost=${Number(costWei) / 1e18} ETH`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
