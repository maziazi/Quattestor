use cosmwasm_std::{entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult};

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, IsAttestedResponse, QueryMsg};
use crate::state::{ATTESTED, TRUSTED_OPERATOR};

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    let operator = deps.api.addr_validate(&msg.trusted_operator)?;
    TRUSTED_OPERATOR.save(deps.storage, &operator)?;
    Ok(Response::new().add_attribute("trusted_operator", operator))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::SubmitAttestation { action_hash } => submit_attestation(deps, info, action_hash),
    }
}

fn submit_attestation(
    deps: DepsMut,
    info: MessageInfo,
    action_hash: Binary,
) -> Result<Response, ContractError> {
    let operator = TRUSTED_OPERATOR.load(deps.storage)?;
    if info.sender != operator {
        return Err(ContractError::UntrustedOperator {});
    }

    let key = action_hash.as_slice();
    if ATTESTED.may_load(deps.storage, key)?.unwrap_or(false) {
        return Err(ContractError::AlreadyAttested {});
    }
    ATTESTED.save(deps.storage, key, &true)?;

    Ok(Response::new()
        .add_attribute("action", "submit_attestation")
        .add_attribute("action_hash", action_hash.to_base64())
        .add_attribute("operator", info.sender))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::IsAttested { action_hash } => {
            let is_attested = ATTESTED
                .may_load(deps.storage, action_hash.as_slice())?
                .unwrap_or(false);
            to_json_binary(&IsAttestedResponse { is_attested })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{message_info, mock_dependencies, mock_env};
    use cosmwasm_std::{from_json, Addr};

    fn setup() -> (cosmwasm_std::OwnedDeps<cosmwasm_std::testing::MockStorage, cosmwasm_std::testing::MockApi, cosmwasm_std::testing::MockQuerier>, Addr) {
        let mut deps = mock_dependencies();
        let operator = deps.api.addr_make("operator");
        let info = message_info(&deps.api.addr_make("deployer"), &[]);
        instantiate(
            deps.as_mut(),
            mock_env(),
            info,
            InstantiateMsg { trusted_operator: operator.to_string() },
        )
        .unwrap();
        (deps, operator)
    }

    #[test]
    fn happy_path_submit_and_query() {
        let (mut deps, operator) = setup();
        let action_hash = Binary::from(vec![1u8; 32]);

        execute(
            deps.as_mut(),
            mock_env(),
            message_info(&operator, &[]),
            ExecuteMsg::SubmitAttestation { action_hash: action_hash.clone() },
        )
        .unwrap();

        let res = query(deps.as_ref(), mock_env(), QueryMsg::IsAttested { action_hash }).unwrap();
        let parsed: IsAttestedResponse = from_json(res).unwrap();
        assert!(parsed.is_attested);
    }

    #[test]
    fn reject_untrusted_operator() {
        let (mut deps, _operator) = setup();
        let attacker = deps.api.addr_make("attacker");
        let action_hash = Binary::from(vec![2u8; 32]);

        let err = execute(
            deps.as_mut(),
            mock_env(),
            message_info(&attacker, &[]),
            ExecuteMsg::SubmitAttestation { action_hash },
        )
        .unwrap_err();

        assert!(matches!(err, ContractError::UntrustedOperator {}));
    }

    #[test]
    fn reject_double_attestation() {
        let (mut deps, operator) = setup();
        let action_hash = Binary::from(vec![3u8; 32]);

        execute(
            deps.as_mut(),
            mock_env(),
            message_info(&operator, &[]),
            ExecuteMsg::SubmitAttestation { action_hash: action_hash.clone() },
        )
        .unwrap();

        let err = execute(
            deps.as_mut(),
            mock_env(),
            message_info(&operator, &[]),
            ExecuteMsg::SubmitAttestation { action_hash },
        )
        .unwrap_err();

        assert!(matches!(err, ContractError::AlreadyAttested {}));
    }

    #[test]
    fn unattested_hash_queries_false() {
        let (deps, _operator) = setup();
        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::IsAttested { action_hash: Binary::from(vec![9u8; 32]) },
        )
        .unwrap();
        let parsed: IsAttestedResponse = from_json(res).unwrap();
        assert!(!parsed.is_attested);
    }
}
