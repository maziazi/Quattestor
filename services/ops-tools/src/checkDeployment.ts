import { createEvmProvider } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * Doc07 §4: wajib dijalankan tiap kali setelah `forge script --broadcast`,
 * sebelum mengisi dana ke Vault (checklist keamanan mainnet di PLAN.md §4).
 * Mengkonfirmasi address yang dicatat benar-benar berisi bytecode, bukan
 * EOA kosong karena salah paste address.
 */
async function main() {
  const provider = createEvmProvider(requireEnv("ETH_RPC_URL"), requireEnv("NOWNODES_API_KEY"));

  const targets: [string, string][] = [
    ["Vault", requireEnv("VAULT_ADDRESS")],
    ["Verifier", requireEnv("VERIFIER_ADDRESS")],
  ];

  let allOk = true;
  for (const [name, address] of targets) {
    const code = await provider.getCode(address);
    const ok = code !== "0x";
    allOk &&= ok;
    console.log(
      `${name} (${address}): ${ok ? "PASS -- bytecode present" : "FAIL -- empty, check address"} (${(code.length - 2) / 2} bytes)`,
    );
  }

  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
