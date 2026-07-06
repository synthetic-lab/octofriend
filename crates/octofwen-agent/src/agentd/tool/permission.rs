use crate::permissions::ToolCallPermissionRequest;
use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::Value;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolPermissionParams {
    tool_name: String,
    parsed: Value,
}

pub(in crate::agentd) fn tool_permission_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ToolPermissionParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let policy =
        ToolCallPermissionRequest::new(params.tool_name, params.parsed).permission_policy();
    create_json_rpc_success(
        id,
        serde_json::json!({
            "whitelistKey": policy.whitelist_key,
            "skipConfirmation": policy.skip_confirmation,
            "alwaysRequestPermission": policy.always_request_permission,
        }),
    )
}
