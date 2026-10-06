use anchor_lang::prelude::*;

use crate::{constants::*, state::Config};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(ctx: Context<InitializeConfig>, trusted_operator: Pubkey) -> Result<()> {
    ctx.accounts.config.trusted_operator = trusted_operator;
    Ok(())
}
