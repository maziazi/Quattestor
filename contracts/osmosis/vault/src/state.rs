use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};

pub const VERIFIER: Item<Addr> = Item::new("verifier");

/// Sequential per-user counter -- same replay-protection pattern as the
/// Solana adapter's `VaultPda.counter`, deliberately NOT a random hash key
/// (architecture doc §5.3).
pub const NONCES: Map<&Addr, u64> = Map::new("nonces");
