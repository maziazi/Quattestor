use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}

/// Attestation-as-NFT minting policy (architecture doc §5 equivalent for
/// Cardano). Unlike EVM's `Verifier.sol` or Solana's `AttestationPda`,
/// eUTXO has no persistent "mapping" to write to -- an attestation is
/// instead represented by minting exactly one token under this policy,
/// asset name == actionHash. `vault.ak` later requires burning that same
/// token in the same transaction that performs a withdraw, which gives
/// one-time-use (replay protection) for free from the ledger's own
/// double-spend rule -- no separate nonce bookkeeping needed on this side.
///
/// Minting (positive quantity) requires `trusted_operator`'s signature.
/// Burning (negative quantity) is unrestricted -- it only ever destroys
/// value, and `vault.ak` is the one actually requiring the burn to happen.
pub fn can_mint(
  trusted_operator: VerificationKeyHash,
  policy_id: PolicyId,
  self: Transaction,
) -> Bool {
  let minted = assets.tokens(self.mint, policy_id)
  dict.foldr(
    minted,
    True,
    fn(_asset_name, quantity, acc) {
      acc && (quantity < 0 || list.has(self.extra_signatories, trusted_operator))
    },
  )
}

validator verifier(trusted_operator: VerificationKeyHash) {
  mint(_redeemer: Data, policy_id: PolicyId, self: Transaction) -> Bool {
    can_mint(trusted_operator, policy_id, self)
  }

  else(_) {
    fail
  }
}

test can_mint_succeeds_when_operator_signs() {
  let operator = #"01"
  let policy_id = #"ab"
  let tx =
    Transaction {
      ..transaction.placeholder,
      mint: assets.from_asset(policy_id, #"beef", 1),
      extra_signatories: [operator],
    }
  can_mint(operator, policy_id, tx)
}

test can_mint_fails_when_non_operator_signs() {
  let operator = #"01"
  let attacker = #"02"
  let policy_id = #"ab"
  let tx =
    Transaction {
      ..transaction.placeholder,
      mint: assets.from_asset(policy_id, #"beef", 1),
      extra_signatories: [attacker],
    }
  !can_mint(operator, policy_id, tx)
}

test can_mint_allows_burn_without_operator_signature() {
  let operator = #"01"
  let policy_id = #"ab"
  let tx =
    Transaction {
      ..transaction.placeholder,
      mint: assets.from_asset(policy_id, #"beef", -1),
      extra_signatories: [],
    }
  can_mint(operator, policy_id, tx)
}
