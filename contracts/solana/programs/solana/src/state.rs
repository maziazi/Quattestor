use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub trusted_operator: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct VaultPda {
    pub counter: u64,
}

#[account]
#[derive(InitSpace)]
pub struct AttestationPda {
    pub action_hash: [u8; 32],
    pub is_attested: bool,
}
