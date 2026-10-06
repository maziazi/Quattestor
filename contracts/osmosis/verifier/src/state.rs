use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};

pub const TRUSTED_OPERATOR: Item<Addr> = Item::new("trusted_operator");

/// Keyed by raw actionHash bytes -- same keccak256 output as the EVM and
/// Solana verifiers, just stored under CosmWasm's own Map rather than a
/// Solidity `mapping` or Anchor PDA.
pub const ATTESTED: Map<&[u8], bool> = Map::new("attested");
