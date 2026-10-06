use anchor_lang::prelude::*;
use solana_keccak_hasher::hash as keccak_hash;

use crate::{
    constants::*,
    error::QuattestorError,
    state::{AttestationPda, VaultPda},
};

#[derive(Accounts)]
#[instruction(amount: u64, action_hash: [u8; 32])]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, user.key().as_ref()], bump)]
    pub vault: Account<'info, VaultPda>,
    /// Closed on consumption -- rent refunded to `user` (architecture doc §9.5,
    /// "aman diterapkan sekarang": this is the one Solana gas-saving mechanism
    /// cleared for immediate use, unlike the ETH-side options which stayed
    /// roadmap-only to avoid touching an already-tested contract).
    #[account(
        mut,
        seeds = [ATTESTATION_SEED, action_hash.as_ref()],
        bump,
        close = user,
    )]
    pub attestation: Account<'info, AttestationPda>,
}

/// Same 5 logical inputs and keccak256 algorithm as the EVM and Osmosis
/// verifiers (architecture doc §5.2): vault identifier, chain/program
/// discriminator, user identifier, amount, counter. `program_id` plays the
/// role `chainId` plays on EVM -- Solana has no single global chain id, so
/// the program's own address is the domain separator instead.
pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64, action_hash: [u8; 32]) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let counter = ctx.accounts.vault.counter;

    let mut data = Vec::with_capacity(32 + 32 + 32 + 8 + 8);
    data.extend_from_slice(vault_key.as_ref());
    data.extend_from_slice(ctx.program_id.as_ref());
    data.extend_from_slice(ctx.accounts.user.key.as_ref());
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&counter.to_le_bytes());
    let computed = keccak_hash(&data).to_bytes();

    require!(computed == action_hash, QuattestorError::ActionHashMismatch);
    require!(ctx.accounts.attestation.is_attested, QuattestorError::NotAttested);

    ctx.accounts.vault.counter = counter.checked_add(1).ok_or(QuattestorError::Overflow)?;

    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += amount;

    Ok(())
}
