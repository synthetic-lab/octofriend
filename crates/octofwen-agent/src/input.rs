use octofwen_store::repo::input::{InputHistoryOptions, InputHistoryRepository};
use octofwen_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputHistoryLoadParams {
    database_path: Option<PathBuf>,
    max_history_items: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputHistoryAppendParams {
    database_path: Option<PathBuf>,
    max_history_items: Option<usize>,
    input: String,
}

pub(super) fn input_history_load_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let params = match params {
        Some(value) => value,
        None => json!({}),
    };
    let Ok(params) = serde_json::from_value::<InputHistoryLoadParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let options = InputHistoryOptions {
        database_path: params.database_path,
        max_history_items: params.max_history_items,
    };
    match InputHistoryRepository::open(options) {
        Ok(repository) => create_json_rpc_success(
            id,
            json!({
                "history": repository.current_history(),
            }),
        ),
        Err(error) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Invalid params",
            Some(json!({ "message": error.to_string() })),
        ),
    }
}

pub(super) fn input_history_append_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<InputHistoryAppendParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let options = InputHistoryOptions {
        database_path: params.database_path,
        max_history_items: params.max_history_items,
    };
    let mut repository = match InputHistoryRepository::open(options) {
        Ok(repository) => repository,
        Err(error) => {
            return create_json_rpc_error(
                id,
                INVALID_PARAMS,
                "Invalid params",
                Some(json!({ "message": error.to_string() })),
            );
        }
    };
    if let Err(error) = repository.append(&params.input) {
        return create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Invalid params",
            Some(json!({ "message": error.to_string() })),
        );
    }
    create_json_rpc_success(
        id,
        json!({
            "history": repository.current_history(),
        }),
    )
}
