pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("8AS1r7wzeTamJwJ6R8P3hrySqbitHXEnkrwRwobykZcY");

#[program]
pub mod solana {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, trusted_operator: Pubkey) -> Result<()> {
        crate::instructions::initialize_config::handle_initialize_config(ctx, trusted_operator)
    }

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        crate::instructions::initialize_vault::handle_initialize_vault(ctx)
    }

    pub fn submit_attestation(ctx: Context<SubmitAttestation>, action_hash: [u8; 32]) -> Result<()> {
        crate::instructions::submit_attestation::handle_submit_attestation(ctx, action_hash)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64, action_hash: [u8; 32]) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx, amount, action_hash)
    }
}
