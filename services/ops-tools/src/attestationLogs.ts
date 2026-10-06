import { Interface } from "ethers";
import { createEvmProvider } from "@quattestor/adapters";
import { requireEnv } from "./env.js";

/**
 * Doc07 §5: eth_getLogs sebagai pelengkap WSS -- backfill histori
 * AttestationSubmitted, bukan cuma trigger real-time.
 */
const VERIFIER_ABI = ["event AttestationSubmitted(bytes32 indexed actionHash, address indexed operator)"];

async function main() {
  const provider = createEvmProvider(requireEnv("ETH_RPC_URL"), requireEnv("NOWNODES_API_KEY"));
  const iface = new Interface(VERIFIER_ABI);
  const topic = iface.getEvent("AttestationSubmitted")!.topicHash;

  const logs = await provider.send("eth_getLogs", [
    {
      address: requireEnv("VERIFIER_ADDRESS"),
      topics: [topic],
      fromBlock: process.env.FROM_BLOCK ?? "0x0",
      toBlock: "latest",
    },
  ]);

  for (const log of logs) {
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    console.log(
      `block ${Number.parseInt(log.blockNumber, 16)} tx ${log.transactionHash}: actionHash=${parsed?.args.actionHash} operator=${parsed?.args.operator}`,
    );
  }
  console.log(`total attestations found: ${logs.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
