# Quattestor

A post-quantum attestation layer for on-chain vaults. Sensitive actions
(`Vault.withdraw`) stay gated behind today's classical signatures, but can
only execute after being attested as also signed with an ML-DSA (FIPS 204)
post-quantum key -- verified off-chain, enforced on-chain for ~25k gas
instead of the 1.2M-8.1M gas direct ML-DSA verification would cost.

Built for the **Origins Hackathon (TOKEN2049 Singapore)**, NOWNodes
"Multichain Infrastructure Challenge" track.

## Architecture

```
User --dual-signs (off-chain, free)--> Verifier Service --pq-sidecar (ML-DSA verify)
                                              |
                                   Operator signs Attestation
                                              |
                                   submitAttestation() [on-chain, ~25k gas]
                                              |
                                   Vault.withdraw() checks isAttested()
```

One `actionHash` formula, one ML-DSA verification module, reused unmodified
across every target chain. Only a `ChainAdapter` implementation differs per
chain/VM -- see `packages/core/src/chainAdapter.ts`.

## Repo layout

```
contracts/evm/          Foundry: Vault.sol + Verifier.sol (ETH Sepolia / Base Sepolia)
contracts/solana/       Anchor program quattestor_solana (VaultPda / AttestationPda)
contracts/cardano/      Aiken: vault.ak (spending validator) + verifier.ak (minting policy)
packages/core/          actionHash formula, ML-DSA sign/verify, ChainAdapter interface
packages/adapters/      ChainAdapter implementations: evm.ts, solana.ts, cardano.ts (all implemented)
services/verifier-service/   Off-chain orchestrator + HTTP API + NOWNodes WSS listener
services/signer-script/      CLI: computes actionHash, dual-signs, calls verifier-service, withdraws
services/ops-tools/          NOWNodes forensic scripts: deploy check, gas proof, logs, real gas numbers
```

## Why these chains

**ETH Sepolia + Base Sepolia (L2) + Solana mainnet + Cardano mainnet.**
Confirmed directly by NOWNodes support for this hackathon's keys (6 Okt
2026): Base Sepolia is enabled specifically for hackathon keys (not
publicly documented -- plain HTTP probing alone would have missed it);
Solana and Cardano are mainnet-only, no devnet/testnet access on this key.
Arbitrum and Osmosis were dropped from the original 5-chain plan once that
came back -- see `PLAN.md` for the full history and reasoning.

Cardano's eUTXO model has no persistent account/mapping the way EVM,
Solana, and Cosmos SDK chains do, so its Vault/Verifier pair is shaped
differently on purpose: "attestation" is an NFT minted under a policy
gated to the trusted operator, and the ledger's own one-time-spendable UTXO
rule gives replay protection for free, without a nonce check. Details and
the deliberate adaptation of the actionHash formula are documented in
`contracts/cardano/validators/vault.ak`.

## Running the tests

```bash
cd contracts/evm && forge test -vv          # 6/6 passing: happy path + 4 negative cases

cd contracts/solana && cargo test            # 4/4 passing, via litesvm (no validator needed)

cd contracts/cardano && aiken check          # 7/7 passing (vault 4/4, verifier 3/3)
```

```bash
# Deploy EVM (same script, only --rpc-url changes between ETH Sepolia and Base Sepolia):
cd contracts/evm
forge script script/Deploy.s.sol \
  --rpc-url $ETH_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

```bash
pnpm install
pnpm --filter @quattestor/verifier-service dev    # starts HTTP API on :8787
pnpm --filter @quattestor/signer-script start      # signs + attests + withdraws
```

Copy `.env.example` to `.env` and fill in a NOWNodes API key plus demo-only
private keys before running either service.

## NOWNodes infrastructure pillars used

RPC (core), WebSockets (`eth_subscribe` logs -- real-time attestation
trigger, no webhook support on EVM), Archive Nodes, Debug & Trace. gRPC and
Blockbook deliberately skipped -- reasoning in `PLAN.md`.

See `PLAN.md` for what's built, what's left, and the hour-by-hour schedule.
