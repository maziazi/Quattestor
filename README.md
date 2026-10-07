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
services/ops-tools/          NOWNodes forensic scripts, deploy check, e2e demos for Solana/Cardano
```

## Live, on real chains -- not simulated

Full happy path (dual-sign -> attest -> withdraw) run against real RPC
endpoints on all four chains, each confirmed on-chain:

| Chain | Network | Attest tx | Withdraw tx |
|---|---|---|---|
| Ethereum | Sepolia | [`0x42ad8e68...`](https://sepolia.etherscan.io/tx/0x42ad8e68e0a7dd508875ee5d301084e7f1cf321377f460256804a4545fc19e24) | [`0x5b2bc17f...`](https://sepolia.etherscan.io/tx/0x5b2bc17f71c4840736ab333665cfedd3c8261547d341dd35d821829fac012a61) |
| Base | Sepolia | [`0xc74db678...`](https://sepolia.basescan.org/tx/0xc74db67810e392144463f2be8d4a90cf57a384ea6d8fec58a8086d0d8e0e4b7f) | [`0x4881605d...`](https://sepolia.basescan.org/tx/0x4881605d016727a88b3fe127ebb6e66dfaade5ad9a1104c3bc703c82e4bc7abf) |
| Solana | Devnet | [`seK7z9WP...`](https://solscan.io/tx/seK7z9WPXmiaNLjdiDD3yC8ufPN7b9A1JHFeS5vkhZV4RjSwubtotyzC6JeE1VA6dDMY7qJgzn5Z4ckGDC7UM1z?cluster=devnet) | [`3syF8GeK...`](https://solscan.io/tx/3syF8GeKhrfDALkam2pyw5yJNf3FQD8hV7yGaaMv9NSftNjVKZkwVme9LJbBkj9PiCVL7oMTH8YGcftHLFwipPQM?cluster=devnet) |
| Cardano | Preprod | [`c2f7a168...`](https://preprod.cardanoscan.io/transaction/c2f7a1682dd6955d565f5d055e07eaa9a1b3cddcfc6fe368c3764b1890df3a1d) | [`3dd42481...`](https://preprod.cardanoscan.io/transaction/3dd42481fee3d089b5c618f9b422ad7742d6cc01b394c37852c7f5b786d67bd0) |

Ethereum and Base are already on the chains this submission targets.
Solana and Cardano's *confirmed* NOWNodes access is mainnet-only -- devnet
and Cardano preprod testnet above are free pre-mainnet validation of the
exact same adapter code, no logic changes, before risking real funds.

Getting there also surfaced real bugs, not just green checkmarks:
NOWNodes' Cardano `/tx/submit` crashes server-side on a real signed
transaction (worked around by submitting through Koios's public endpoint
instead, reads stay on NOWNodes); and `submitAttestation`/
`executeVaultAction` were missing a required-signer declaration that only
a real on-chain Plutus script execution exposed (`aiken check`'s own unit
tests construct the `Transaction` object directly and never hit this
path). Full writeup, including the Base-Sepolia and Archive-Node
discoveries, in `PLAN.md`.

## Why these chains

**ETH Sepolia + Base Sepolia (L2) + Solana + Cardano.** Confirmed directly
by NOWNodes support for this hackathon's keys (6 Okt 2026): Base Sepolia
is enabled specifically for hackathon keys (not publicly documented --
plain HTTP probing alone would have missed it); Solana and Cardano's
NOWNodes-confirmed access is mainnet. Arbitrum and Osmosis were dropped
from the original 5-chain plan once that came back -- see `PLAN.md` for
the full history and reasoning.

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
# Deploy EVM (same script, only --rpc-url changes between ETH Sepolia and Base Sepolia).
# NOTE: forge/cast can't send the custom `api-key` header NOWNodes requires --
# use the API key embedded in the URL path instead (confirmed working),
# NOT $ETH_RPC_URL (that one is header-based, for the TS services only).
cd contracts/evm
forge script script/Deploy.s.sol \
  --rpc-url https://eth-sepolia.nownodes.io/$NOWNODES_API_KEY \
  --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

```bash
pnpm install
pnpm --filter @quattestor/verifier-service dev    # EVM: starts HTTP API on :8787
pnpm --filter @quattestor/signer-script start      # EVM: signs + attests + withdraws

# Solana and Cardano go through the ChainAdapter directly instead --
# verifier-service's actionHash formula is EVM-only ABI encoding, see the
# comment at the top of each script for why.
pnpm --filter @quattestor/ops-tools solana-e2e
pnpm --filter @quattestor/ops-tools cardano-e2e
```

Copy `.env.example` to `.env` and fill in a NOWNodes API key plus demo-only
private keys before running any service.

## NOWNodes infrastructure pillars used

RPC (core -- every chain above runs its full attest+withdraw cycle
through it) and Cardano's Blockfrost-compatible REST API, confirmed on
both mainnet and a free preprod testnet endpoint. Archive Nodes: probed
with a binary-search exposure finder (`services/ops-tools/src/firstExposureFinder.ts`)
-- found this hackathon key's historical depth is ~128 blocks (standard
pruning window), not a true archive; reported honestly rather than
assumed. Debug & Trace (`debug_traceTransaction`) returns
`405 Method Not Allowed` on this key -- confirmed against two independent
non-NOWNodes providers too, so it's an industry-wide paid-tier
restriction, not something specific to this key. gRPC and Blockbook
deliberately skipped -- reasoning in `PLAN.md`.

See `PLAN.md` for what's built, what's left, and the hour-by-hour schedule.
