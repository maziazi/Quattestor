use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Binary;

#[cw_serde]
pub struct InstantiateMsg {
    pub trusted_operator: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    SubmitAttestation { action_hash: Binary },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(IsAttestedResponse)]
    IsAttested { action_hash: Binary },
}

#[cw_serde]
pub struct IsAttestedResponse {
    pub is_attested: bool,
}
