import { createServer, type IncomingMessage } from "node:http";
import { createEvmAdapter } from "@quattestor/adapters";
import { AttestationRejected, Orchestrator } from "./orchestrator.js";
import { subscribeLogs } from "./wss.js";

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const adapter = createEvmAdapter({
  rpcUrl: requireEnv("ETH_RPC_URL"),
  apiKey: requireEnv("NOWNODES_API_KEY"),
  vaultAddress: requireEnv("VAULT_ADDRESS"),
  verifierAddress: requireEnv("VERIFIER_ADDRESS"),
});

const orchestrator = new Orchestrator(adapter, requireEnv("OPERATOR_PRIVATE_KEY"));

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/attest") {
    try {
      const body = (await readJsonBody(req)) as any;
      const txHash = await orchestrator.processAttestation({
        intent: {
          vault: body.intent.vault,
          chainId: BigInt(body.intent.chainId),
          user: body.intent.user,
          amount: BigInt(body.intent.amount),
          nonce: BigInt(body.intent.nonce),
        },
        signatures: {
          classicalSignature: hexToBytes(body.signatures.classicalSignature),
          pqSignature: hexToBytes(body.signatures.pqSignature),
          claimedIdentity: body.signatures.claimedIdentity,
        },
        claimedPqPublicKey: hexToBytes(body.claimedPqPublicKey),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ txHash }));
    } catch (err) {
      const status = err instanceof AttestationRejected ? 400 : 500;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`[verifier-service] listening on :${port}`);
});

if (process.env.VERIFIER_ADDRESS && process.env.ETH_WSS_URL) {
  subscribeLogs(process.env.ETH_WSS_URL, { address: process.env.VERIFIER_ADDRESS }, (log) => {
    console.log("[wss] AttestationSubmitted log:", log);
  });
}
