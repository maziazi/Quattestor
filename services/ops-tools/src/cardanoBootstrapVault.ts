import { bootstrapVault, type CardanoAdapterConfig } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * PLAN.md §3c: eUTXO has no equivalent to `Deploy.s.sol` / Solana's
 * `initialize_vault` -- something has to create the first Vault UTxO
 * before any attestation/withdraw flow can touch it. This is that script,
 * run once per owner before their first demo.
 *
 * Usage: CARDANO_BOOTSTRAP_LOVELACE=5000000 \
 *   node --experimental-strip-types src/cardanoBootstrapVault.ts
 */
async function main() {
  const cfg: CardanoAdapterConfig = {
    rpcUrl: requireEnv("CARDANO_RPC_URL"),
    apiKey: requireEnv("NOWNODES_API_KEY"),
    network: (process.env.CARDANO_NETWORK as CardanoAdapterConfig["network"]) ?? "Mainnet",
    plutusBlueprintPath: requireEnv("CARDANO_PLUTUS_BLUEPRINT_PATH"),
    trustedOperatorPkh: requireEnv("CARDANO_TRUSTED_OPERATOR_PKH"),
  };

  const ownerSkey = requireEnv("CARDANO_USER_SKEY");
  const initialLovelace = BigInt(process.env.CARDANO_BOOTSTRAP_LOVELACE ?? "5000000");

  const txHash = await bootstrapVault(cfg, ownerSkey, initialLovelace);
  console.log(`vault bootstrapped: ${initialLovelace} lovelace, tx ${txHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
