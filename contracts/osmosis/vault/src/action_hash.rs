use cosmwasm_std::{Addr, Uint128};
use sha3::{Digest, Keccak256};

/// Same 5 logical inputs and keccak256 algorithm as the EVM (`Vault.sol`)
/// and Solana (`quattestor_solana`) verifiers -- architecture doc §5.3.
/// Byte serialization necessarily differs per VM: here, UTF-8 bytes for
/// addresses/chain_id (bech32 strings, not 20-byte EVM addresses) and
/// big-endian for the numeric fields. Must use `sha3::Keccak256`, NOT
/// Cosmos SDK's native sha256, so the algorithm stays identical everywhere.
pub fn compute_action_hash(
    vault_addr: &Addr,
    chain_id: &str,
    user_addr: &Addr,
    amount: Uint128,
    nonce: u64,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(vault_addr.as_bytes());
    hasher.update(chain_id.as_bytes());
    hasher.update(user_addr.as_bytes());
    hasher.update(amount.u128().to_be_bytes());
    hasher.update(nonce.to_be_bytes());
    hasher.finalize().into()
}
