use cosmwasm_std::{
    entry_point, to_json_binary, BankMsg, Coin, Deps, DepsMut, Env, MessageInfo, QueryRequest,
    Response, StdResult, Uint128, WasmQuery,
};

use crate::action_hash::compute_action_hash;
use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, NonceResponse, QueryMsg};
use crate::state::{NONCES, VERIFIER};

const DENOM: &str = "uosmo";

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    let verifier = deps.api.addr_validate(&msg.verifier)?;
    VERIFIER.save(deps.storage, &verifier)?;
    Ok(Response::new().add_attribute("verifier", verifier))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Withdraw { amount, nonce } => withdraw(deps, env, info, amount, nonce),
    }
}

fn withdraw(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    amount: Uint128,
    nonce: u64,
) -> Result<Response, ContractError> {
    let user = info.sender.clone();
    let current_nonce = NONCES.may_load(deps.storage, &user)?.unwrap_or(0);
    if nonce != current_nonce {
        return Err(ContractError::BadNonce {});
    }

    let verifier = VERIFIER.load(deps.storage)?;
    let action_hash = compute_action_hash(&env.contract.address, &env.block.chain_id, &user, amount, nonce);

    let is_attested: quattestor_verifier::msg::IsAttestedResponse =
        deps.querier.query(&QueryRequest::Wasm(WasmQuery::Smart {
            contract_addr: verifier.to_string(),
            msg: to_json_binary(&quattestor_verifier::msg::QueryMsg::IsAttested {
                action_hash: action_hash.to_vec().into(),
            })?,
        }))?;

    if !is_attested.is_attested {
        return Err(ContractError::NotAttested {});
    }

    NONCES.save(deps.storage, &user, &(nonce + 1))?;

    let payout = BankMsg::Send {
        to_address: user.to_string(),
        amount: vec![Coin { denom: DENOM.to_string(), amount }],
    };

    Ok(Response::new()
        .add_message(payout)
        .add_attribute("action", "withdraw")
        .add_attribute("user", user)
        .add_attribute("amount", amount))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<cosmwasm_std::Binary> {
    match msg {
        QueryMsg::Nonce { user } => {
            let addr = deps.api.addr_validate(&user)?;
            let nonce = NONCES.may_load(deps.storage, &addr)?.unwrap_or(0);
            to_json_binary(&NonceResponse { nonce })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{message_info, mock_dependencies, mock_env};
    use cosmwasm_std::{coins, Addr, Empty};
    use cw_multi_test::{App, ContractWrapper, Executor};

    #[test]
    fn reject_bad_nonce_without_querying_verifier() {
        let mut deps = mock_dependencies();
        let verifier = deps.api.addr_make("verifier");
        let deployer = deps.api.addr_make("deployer");
        instantiate(
            deps.as_mut(),
            mock_env(),
            message_info(&deployer, &[]),
            InstantiateMsg { verifier: verifier.to_string() },
        )
        .unwrap();

        let user = deps.api.addr_make("user");
        let err = execute(
            deps.as_mut(),
            mock_env(),
            message_info(&user, &[]),
            ExecuteMsg::Withdraw { amount: Uint128::new(100), nonce: 5 },
        )
        .unwrap_err();

        assert!(matches!(err, ContractError::BadNonce {}));
    }

    fn verifier_contract() -> Box<dyn cw_multi_test::Contract<Empty>> {
        Box::new(ContractWrapper::new(
            quattestor_verifier::contract::execute,
            quattestor_verifier::contract::instantiate,
            quattestor_verifier::contract::query,
        ))
    }

    fn vault_contract() -> Box<dyn cw_multi_test::Contract<Empty>> {
        Box::new(ContractWrapper::new(execute, instantiate, query))
    }

    fn setup_contracts(app: &mut App) -> (Addr, Addr, Addr, Addr) {
        let operator = app.api().addr_make("operator");
        let user = app.api().addr_make("user");

        let verifier_code = app.store_code(verifier_contract());
        let verifier_addr = app
            .instantiate_contract(
                verifier_code,
                operator.clone(),
                &quattestor_verifier::msg::InstantiateMsg { trusted_operator: operator.to_string() },
                &[],
                "verifier",
                None,
            )
            .unwrap();

        let vault_code = app.store_code(vault_contract());
        let vault_addr = app
            .instantiate_contract(
                vault_code,
                app.api().addr_make("deployer"),
                &InstantiateMsg { verifier: verifier_addr.to_string() },
                &[],
                "vault",
                None,
            )
            .unwrap();

        (operator, user, verifier_addr, vault_addr)
    }

    #[test]
    fn happy_path_withdraw_after_attestation() {
        let faucet = Addr::unchecked("faucet");
        let mut app = App::new(|router, _api, storage| {
            router.bank.init_balance(storage, &faucet, coins(1_000, DENOM)).unwrap();
        });

        let (operator, user, verifier_addr, vault_addr) = setup_contracts(&mut app);
        app.send_tokens(faucet, vault_addr.clone(), &coins(1_000, DENOM)).unwrap();

        let amount = Uint128::new(100);
        let nonce = 0u64;
        let chain_id = app.block_info().chain_id;
        let action_hash = compute_action_hash(&vault_addr, &chain_id, &user, amount, nonce);

        app.execute_contract(
            operator,
            verifier_addr,
            &quattestor_verifier::msg::ExecuteMsg::SubmitAttestation { action_hash: action_hash.to_vec().into() },
            &[],
        )
        .unwrap();

        app.execute_contract(user.clone(), vault_addr.clone(), &ExecuteMsg::Withdraw { amount, nonce }, &[])
            .unwrap();

        let balance = app.wrap().query_balance(&user, DENOM).unwrap();
        assert_eq!(balance.amount, amount);

        let nonce_resp: NonceResponse = app
            .wrap()
            .query_wasm_smart(vault_addr, &QueryMsg::Nonce { user: user.to_string() })
            .unwrap();
        assert_eq!(nonce_resp.nonce, 1);
    }

    #[test]
    fn reject_withdraw_without_attestation() {
        let faucet = Addr::unchecked("faucet");
        let mut app = App::new(|router, _api, storage| {
            router.bank.init_balance(storage, &faucet, coins(1_000, DENOM)).unwrap();
        });

        let (_operator, user, _verifier_addr, vault_addr) = setup_contracts(&mut app);
        app.send_tokens(faucet, vault_addr.clone(), &coins(1_000, DENOM)).unwrap();

        let err = app
            .execute_contract(user, vault_addr, &ExecuteMsg::Withdraw { amount: Uint128::new(100), nonce: 0 }, &[])
            .unwrap_err();

        assert!(format!("{err:#}").contains("not attested"));
    }

    #[test]
    fn reject_replay_same_nonce() {
        let faucet = Addr::unchecked("faucet");
        let mut app = App::new(|router, _api, storage| {
            router.bank.init_balance(storage, &faucet, coins(1_000, DENOM)).unwrap();
        });

        let (operator, user, verifier_addr, vault_addr) = setup_contracts(&mut app);
        app.send_tokens(faucet, vault_addr.clone(), &coins(1_000, DENOM)).unwrap();

        let amount = Uint128::new(100);
        let chain_id = app.block_info().chain_id;
        let action_hash = compute_action_hash(&vault_addr, &chain_id, &user, amount, 0);

        app.execute_contract(
            operator,
            verifier_addr,
            &quattestor_verifier::msg::ExecuteMsg::SubmitAttestation { action_hash: action_hash.to_vec().into() },
            &[],
        )
        .unwrap();

        app.execute_contract(user.clone(), vault_addr.clone(), &ExecuteMsg::Withdraw { amount, nonce: 0 }, &[])
            .unwrap();

        let err = app
            .execute_contract(user, vault_addr, &ExecuteMsg::Withdraw { amount, nonce: 0 }, &[])
            .unwrap_err();

        assert!(format!("{err:#}").contains("bad nonce"));
    }
}
