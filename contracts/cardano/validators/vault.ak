use aiken/collection/list
use aiken/crypto.{VerificationKeyHash, keccak_256}
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets
use cardano/transaction.{Input, InlineDatum, Output, OutputReference, Transaction}

/// architecture doc §5 equivalent for Cardano -- eUTXO instead of a
/// persistent mapping/account. `counter` is kept for parity with the
/// EVM/Solana actionHash formula even though eUTXO's one-time-spendable
/// attestation token (see verifier.ak) already gives replay protection on
/// its own; this is a deliberate belt-and-suspenders choice, not a gap.
pub type VaultDatum {
  owner: VerificationKeyHash,
  counter: Int,
}

pub type WithdrawRedeemer {
  amount: Int,
  action_hash: ByteArray,
}

/// Same 5-logical-input, keccak256 formula as every other chain in this
/// repo, with one documented difference: Cardano drops the chainId-style
/// network discriminator (Plutus validators have no direct access to a
/// network magic in their execution context, unlike `block.chainid` on EVM
/// or `program_id` on Solana) and substitutes the attestation policy's
/// PolicyId instead -- it serves the same domain-separation purpose
/// (binds the hash to this specific Quattestor deployment).
fn compute_action_hash(
  vault_script_hash: ByteArray,
  attestation_policy_id: ByteArray,
  owner: VerificationKeyHash,
  amount: Int,
  counter: Int,
) -> ByteArray {
  vault_script_hash
    |> bytearray.concat(attestation_policy_id)
    |> bytearray.concat(owner)
    |> bytearray.concat(bytearray.from_int_big_endian(amount, 8))
    |> bytearray.concat(bytearray.from_int_big_endian(counter, 8))
    |> keccak_256()
}

pub fn can_withdraw(
  attestation_policy_id: ByteArray,
  datum: Option<VaultDatum>,
  redeemer: WithdrawRedeemer,
  own_ref: OutputReference,
  self: Transaction,
) -> Bool {
  expect Some(VaultDatum { owner, counter }) = datum

  expect Some(own_input) =
    self.inputs |> list.find(fn(input) { input.output_reference == own_ref })
  expect Script(own_script_hash) = own_input.output.address.payment_credential

  let computed_hash =
    compute_action_hash(
      own_script_hash,
      attestation_policy_id,
      owner,
      redeemer.amount,
      counter,
    )
  expect computed_hash == redeemer.action_hash

  let attestation_burned =
    assets.quantity_of(self.mint, attestation_policy_id, redeemer.action_hash) == -1

  let continuing_output_ok =
    list.any(
      self.outputs,
      fn(output) {
        when output.datum is {
          InlineDatum(data) -> {
            expect next: VaultDatum = data
            and {
              output.address == own_input.output.address,
              next.owner == owner,
              next.counter == counter + 1,
              assets.lovelace_of(output.value) == assets.lovelace_of(
                own_input.output.value,
              ) - redeemer.amount,
            }
          }
          _ -> False
        }
      },
    )

  and {
    attestation_burned,
    continuing_output_ok,
    list.has(self.extra_signatories, owner),
  }
}

validator vault(attestation_policy_id: ByteArray) {
  spend(
    datum: Option<VaultDatum>,
    redeemer: WithdrawRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) -> Bool {
    can_withdraw(attestation_policy_id, datum, redeemer, own_ref, self)
  }

  else(_) {
    fail
  }
}

fn fixture(amount: Int, counter: Int) {
  let attestation_policy_id = #"ab"
  let owner = #"01"
  let own_script_hash = #"cd"
  let own_address = address.from_script(own_script_hash)

  let action_hash =
    compute_action_hash(own_script_hash, attestation_policy_id, owner, amount, counter)

  let own_ref = OutputReference { transaction_id: #"00", output_index: 0 }
  let own_output =
    Output {
      address: own_address,
      value: assets.from_lovelace(1000),
      datum: InlineDatum(VaultDatum { owner, counter }),
      reference_script: None,
    }
  let own_input = Input { output_reference: own_ref, output: own_output }

  (attestation_policy_id, owner, action_hash, own_ref, own_input, own_address)
}

test happy_path_withdraw_after_attestation() {
  let amount = 100
  let counter = 0
  let (attestation_policy_id, owner, action_hash, own_ref, own_input, own_address) =
    fixture(amount, counter)

  let continuing_output =
    Output {
      address: own_address,
      value: assets.from_lovelace(1000 - amount),
      datum: InlineDatum(VaultDatum { owner, counter: counter + 1 }),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [own_input],
      outputs: [continuing_output],
      mint: assets.from_asset(attestation_policy_id, action_hash, -1),
      extra_signatories: [owner],
    }

  can_withdraw(
    attestation_policy_id,
    Some(VaultDatum { owner, counter }),
    WithdrawRedeemer { amount, action_hash },
    own_ref,
    tx,
  )
}

test reject_withdraw_without_attestation_burn() fail {
  let amount = 100
  let counter = 0
  let (attestation_policy_id, owner, action_hash, own_ref, own_input, own_address) =
    fixture(amount, counter)

  let continuing_output =
    Output {
      address: own_address,
      value: assets.from_lovelace(1000 - amount),
      datum: InlineDatum(VaultDatum { owner, counter: counter + 1 }),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [own_input],
      outputs: [continuing_output],
      mint: assets.zero,
      extra_signatories: [owner],
    }

  can_withdraw(
    attestation_policy_id,
    Some(VaultDatum { owner, counter }),
    WithdrawRedeemer { amount, action_hash },
    own_ref,
    tx,
  )
}

test reject_withdraw_wrong_action_hash() fail {
  let amount = 100
  let counter = 0
  let (attestation_policy_id, owner, _action_hash, own_ref, own_input, own_address) =
    fixture(amount, counter)

  let continuing_output =
    Output {
      address: own_address,
      value: assets.from_lovelace(1000 - amount),
      datum: InlineDatum(VaultDatum { owner, counter: counter + 1 }),
      reference_script: None,
    }

  let wrong_hash = #"deadbeef"
  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [own_input],
      outputs: [continuing_output],
      mint: assets.from_asset(attestation_policy_id, wrong_hash, -1),
      extra_signatories: [owner],
    }

  can_withdraw(
    attestation_policy_id,
    Some(VaultDatum { owner, counter }),
    WithdrawRedeemer { amount, action_hash: wrong_hash },
    own_ref,
    tx,
  )
}

test reject_withdraw_replay_with_stale_counter() fail {
  let amount = 100
  let counter = 0
  let (attestation_policy_id, owner, action_hash, own_ref, own_input, own_address) =
    fixture(amount, counter)

  // Simulates replay: the attestation was minted for counter=0 (already
  // spent once), but the vault's own datum now shows counter=1 -- the
  // recomputed hash for counter=1 no longer matches the stale action_hash.
  let stale_datum = Some(VaultDatum { owner, counter: 1 })

  let continuing_output =
    Output {
      address: own_address,
      value: assets.from_lovelace(1000 - amount),
      datum: InlineDatum(VaultDatum { owner, counter: 2 }),
      reference_script: None,
    }

  let tx =
    Transaction {
      ..transaction.placeholder,
      inputs: [own_input],
      outputs: [continuing_output],
      mint: assets.from_asset(attestation_policy_id, action_hash, -1),
      extra_signatories: [owner],
    }

  can_withdraw(
    attestation_policy_id,
    stale_datum,
    WithdrawRedeemer { amount, action_hash },
    own_ref,
    tx,
  )
}
