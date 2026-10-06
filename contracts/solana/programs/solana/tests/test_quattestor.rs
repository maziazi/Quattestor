use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keccak_hasher::hash as keccak_hash,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const LAMPORTS: u64 = 10_000_000_000;

fn new_svm() -> (LiteSVM, Pubkey) {
    let program_id = solana::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/solana.so"));
    svm.add_program(program_id, bytes).unwrap();
    (svm, program_id)
}

fn compute_action_hash(vault: &Pubkey, program_id: &Pubkey, user: &Pubkey, amount: u64, counter: u64) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 + 32 + 32 + 8 + 8);
    data.extend_from_slice(vault.as_ref());
    data.extend_from_slice(program_id.as_ref());
    data.extend_from_slice(user.as_ref());
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&counter.to_le_bytes());
    keccak_hash(&data).to_bytes()
}

fn init_config(svm: &mut LiteSVM, program_id: &Pubkey, payer: &Keypair, operator: &Pubkey) -> Pubkey {
    let config = Pubkey::find_program_address(&[solana::constants::CONFIG_SEED], program_id).0;
    let ix = Instruction::new_with_bytes(
        *program_id,
        &solana::instruction::InitializeConfig { trusted_operator: *operator }.data(),
        solana::accounts::InitializeConfig {
            payer: payer.pubkey(),
            config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx).unwrap();
    config
}

fn init_vault(svm: &mut LiteSVM, program_id: &Pubkey, user: &Keypair) -> Pubkey {
    let vault = Pubkey::find_program_address(&[solana::constants::VAULT_SEED, user.pubkey().as_ref()], program_id).0;
    let ix = Instruction::new_with_bytes(
        *program_id,
        &solana::instruction::InitializeVault {}.data(),
        solana::accounts::InitializeVault {
            user: user.pubkey(),
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    svm.send_transaction(tx).unwrap();
    vault
}

fn submit_attestation(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    operator: &Keypair,
    config: &Pubkey,
    action_hash: [u8; 32],
) -> Result<(), ()> {
    let attestation = Pubkey::find_program_address(&[solana::constants::ATTESTATION_SEED, &action_hash], program_id).0;
    let ix = Instruction::new_with_bytes(
        *program_id,
        &solana::instruction::SubmitAttestation { action_hash }.data(),
        solana::accounts::SubmitAttestation {
            operator: operator.pubkey(),
            config: *config,
            attestation,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&operator.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[operator]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|_| ())
}

fn withdraw(
    svm: &mut LiteSVM,
    program_id: &Pubkey,
    user: &Keypair,
    vault: &Pubkey,
    amount: u64,
    action_hash: [u8; 32],
) -> Result<(), ()> {
    let attestation = Pubkey::find_program_address(&[solana::constants::ATTESTATION_SEED, &action_hash], program_id).0;
    let ix = Instruction::new_with_bytes(
        *program_id,
        &solana::instruction::Withdraw { amount, action_hash }.data(),
        solana::accounts::Withdraw { user: user.pubkey(), vault: *vault, attestation }.to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|_| ())
}

#[test]
fn happy_path_withdraw_after_attestation() {
    let (mut svm, program_id) = new_svm();
    let payer = Keypair::new();
    let operator = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&operator.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&user.pubkey(), LAMPORTS).unwrap();

    let config = init_config(&mut svm, &program_id, &payer, &operator.pubkey());
    let vault = init_vault(&mut svm, &program_id, &user);
    svm.airdrop(&vault, 1_000_000_000).unwrap();

    let amount = 100_000u64;
    let counter = 0u64;
    let action_hash = compute_action_hash(&vault, &program_id, &user.pubkey(), amount, counter);

    submit_attestation(&mut svm, &program_id, &operator, &config, action_hash).unwrap();

    let balance_before = svm.get_balance(&user.pubkey()).unwrap();
    withdraw(&mut svm, &program_id, &user, &vault, amount, action_hash).unwrap();
    let balance_after = svm.get_balance(&user.pubkey()).unwrap();

    assert!(balance_after > balance_before, "user should have received the withdrawn lamports");

    let vault_account = svm.get_account(&vault).unwrap();
    let mut data: &[u8] = &vault_account.data;
    let vault_state = solana::state::VaultPda::try_deserialize(&mut data).unwrap();
    assert_eq!(vault_state.counter, 1);
}

#[test]
fn reject_withdraw_without_attestation() {
    let (mut svm, program_id) = new_svm();
    let payer = Keypair::new();
    let operator = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&operator.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&user.pubkey(), LAMPORTS).unwrap();

    let _config = init_config(&mut svm, &program_id, &payer, &operator.pubkey());
    let vault = init_vault(&mut svm, &program_id, &user);
    svm.airdrop(&vault, 1_000_000_000).unwrap();

    let action_hash = compute_action_hash(&vault, &program_id, &user.pubkey(), 100_000, 0);
    let result = withdraw(&mut svm, &program_id, &user, &vault, 100_000, action_hash);

    assert!(result.is_err(), "withdraw must fail: attestation account was never created");
}

#[test]
fn reject_attestation_from_untrusted_operator() {
    let (mut svm, program_id) = new_svm();
    let payer = Keypair::new();
    let operator = Keypair::new();
    let attacker = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&attacker.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&user.pubkey(), LAMPORTS).unwrap();

    let config = init_config(&mut svm, &program_id, &payer, &operator.pubkey());
    let vault = Pubkey::find_program_address(&[solana::constants::VAULT_SEED, user.pubkey().as_ref()], &program_id).0;
    let action_hash = compute_action_hash(&vault, &program_id, &user.pubkey(), 100_000, 0);

    let result = submit_attestation(&mut svm, &program_id, &attacker, &config, action_hash);
    assert!(result.is_err(), "attestation from a non-operator signer must be rejected");
}

#[test]
fn reject_replay_with_stale_action_hash() {
    let (mut svm, program_id) = new_svm();
    let payer = Keypair::new();
    let operator = Keypair::new();
    let user = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&operator.pubkey(), LAMPORTS).unwrap();
    svm.airdrop(&user.pubkey(), LAMPORTS).unwrap();

    let config = init_config(&mut svm, &program_id, &payer, &operator.pubkey());
    let vault = init_vault(&mut svm, &program_id, &user);
    svm.airdrop(&vault, 1_000_000_000).unwrap();

    let amount = 100_000u64;
    let action_hash = compute_action_hash(&vault, &program_id, &user.pubkey(), amount, 0);
    submit_attestation(&mut svm, &program_id, &operator, &config, action_hash).unwrap();
    withdraw(&mut svm, &program_id, &user, &vault, amount, action_hash).unwrap();

    // Replay: same action_hash again, but vault.counter is now 1, so the
    // on-chain recomputed hash no longer matches -- must be rejected.
    let result = withdraw(&mut svm, &program_id, &user, &vault, amount, action_hash);
    assert!(result.is_err(), "replaying a stale actionHash must be rejected");
}
