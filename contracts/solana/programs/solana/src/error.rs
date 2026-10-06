use anchor_lang::prelude::*;

#[error_code]
pub enum QuattestorError {
    #[msg("signer is not the trusted operator")]
    UntrustedOperator,
    #[msg("recomputed actionHash does not match the one requested")]
    ActionHashMismatch,
    #[msg("attestation for this actionHash is not valid")]
    NotAttested,
    #[msg("counter overflow")]
    Overflow,
}
