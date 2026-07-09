use octofwen_store::repo::updates::{UpdateNotificationsOptions, mark_updates_seen, read_updates};
use octofwen_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateNotificationsParams {
    updates_path: Option<PathBuf>,
    database_path: Option<PathBuf>,
}

pub(super) fn update_notifications_read_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let params = match params {
        Some(value) => value,
        None => json!({}),
    };
    let Ok(params) = serde_json::from_value::<UpdateNotificationsParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let options = UpdateNotificationsOptions {
        updates_path: params.updates_path,
        database_path: params.database_path,
    };
    match read_updates(&options) {
        Ok(updates) => create_json_rpc_success(id, json!({ "updates": updates })),
        Err(error) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Invalid params",
            Some(json!({ "message": error.to_string() })),
        ),
    }
}

pub(super) fn update_notifications_mark_seen_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let params = match params {
        Some(value) => value,
        None => json!({}),
    };
    let Ok(params) = serde_json::from_value::<UpdateNotificationsParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let options = UpdateNotificationsOptions {
        updates_path: params.updates_path,
        database_path: params.database_path,
    };
    match mark_updates_seen(&options) {
        Ok(()) => create_json_rpc_success(id, json!({})),
        Err(error) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Invalid params",
            Some(json!({ "message": error.to_string() })),
        ),
    }
}
