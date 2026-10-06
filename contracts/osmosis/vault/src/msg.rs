use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Uint128;

#[cw_serde]
pub struct InstantiateMsg {
    pub verifier: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    Withdraw { amount: Uint128, nonce: u64 },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(NonceResponse)]
    Nonce { user: String },
}

#[cw_serde]
pub struct NonceResponse {
    pub nonce: u64,
}
