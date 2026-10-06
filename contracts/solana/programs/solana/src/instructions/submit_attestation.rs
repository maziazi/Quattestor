use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::QuattestorError,
    state::{AttestationPda, Config},
};

#[event]
pub struct AttestationSubmitted {
    pub action_hash: [u8; 32],
    pub operator: Pubkey,
}

#[derive(Accounts)]
#[instruction(action_hash: [u8; 32])]
pub struct SubmitAttestation<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump,
        constraint = config.trusted_operator == operator.key() @ QuattestorError::UntrustedOperator,
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = operator,
        space = 8 + AttestationPda::INIT_SPACE,
        seeds = [ATTESTATION_SEED, action_hash.as_ref()],
        bump
    )]
    pub attestation: Account<'info, AttestationPda>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_attestation(ctx: Context<SubmitAttestation>, action_hash: [u8; 32]) -> Result<()> {
    ctx.accounts.attestation.action_hash = action_hash;
    ctx.accounts.attestation.is_attested = true;
    emit!(AttestationSubmitted { action_hash, operator: ctx.accounts.operator.key() });
    Ok(())
}
