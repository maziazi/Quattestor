use anchor_lang::prelude::*;

use crate::{constants::*, state::VaultPda};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + VaultPda::INIT_SPACE,
        seeds = [VAULT_SEED, user.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultPda>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
    ctx.accounts.vault.counter = 0;
    Ok(())
}
