import { Lucid, generatePrivateKey, getAddressDetails } from "@lucid-evolution/lucid";
import { createNowNodesBlockfrostProvider } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * Cardano equivalent of `cast wallet new` / `solana-keygen new` -- nothing
 * in Foundry or the Solana CLI generates Cardano keys, so this fills that
 * gap using Lucid Evolution's own `generatePrivateKey()` (pure local
 * crypto, no network call). Doubles as the first live connectivity check
 * for the NOWNodes Cardano endpoint, since deriving the address through
 * Lucid still requires a working provider.
 */
async function generateWallet(
  lucid: Awaited<ReturnType<typeof Lucid>>,
  label: string,
): Promise<void> {
  const privateKey = generatePrivateKey();
  lucid.selectWallet.fromPrivateKey(privateKey);
  const address = await lucid.wallet().address();
  const pkh = getAddressDetails(address).paymentCredential?.hash;

  console.log(`\n${label}`);
  console.log(`  address:     ${address}`);
  console.log(`  pkh:         ${pkh}`);
  console.log(`  private key: ${privateKey}`);
}

async function main() {
  const network = (process.env.CARDANO_NETWORK as "Mainnet" | "Preprod" | "Preview") ?? "Mainnet";
  const provider = createNowNodesBlockfrostProvider(requireEnv("CARDANO_RPC_URL"), requireEnv("NOWNODES_API_KEY"));
  const lucid = await Lucid(provider, network);

  await generateWallet(lucid, "OPERATOR");
  await generateWallet(lucid, "USER");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
