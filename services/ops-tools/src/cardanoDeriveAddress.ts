import { Lucid, getAddressDetails } from "@lucid-evolution/lucid";
import {
  createNowNodesBlockfrostProvider,
  createNowNodesKoiosProvider,
  selectWalletFromSecret,
} from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * For a user-supplied wallet (Eternl/Nami/Lace, pasted as CARDANO_OPERATOR_SKEY
 * / CARDANO_USER_SKEY in .env): derives address + payment key hash without
 * ever printing the secret itself. CARDANO_TRUSTED_OPERATOR_PKH needs the
 * Operator's pkh specifically -- this is how to get it.
 */
async function derive(
  lucid: Awaited<ReturnType<typeof Lucid>>,
  label: string,
  secret: string,
): Promise<void> {
  selectWalletFromSecret(lucid, secret);
  const address = await lucid.wallet().address();
  const pkh = getAddressDetails(address).paymentCredential?.hash;
  console.log(`\n${label}`);
  console.log(`  address: ${address}`);
  console.log(`  pkh:     ${pkh}`);
}

async function main() {
  const network = (process.env.CARDANO_NETWORK as "Mainnet" | "Preprod" | "Preview") ?? "Mainnet";
  const apiKey = requireEnv("NOWNODES_API_KEY");
  const rpcUrl = requireEnv("CARDANO_RPC_URL");
  const provider =
    process.env.CARDANO_PROVIDER_KIND === "koios"
      ? createNowNodesKoiosProvider(rpcUrl, apiKey)
      : createNowNodesBlockfrostProvider(rpcUrl, apiKey);
  const lucid = await Lucid(provider, network);

  await derive(lucid, "OPERATOR", requireEnv("CARDANO_OPERATOR_SKEY"));
  await derive(lucid, "USER", requireEnv("CARDANO_USER_SKEY"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
