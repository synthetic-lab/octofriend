use std::path::PathBuf;

use octofwen_tools::runtime::validate_runtime_tool_call;
use octofwen_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolValidateParams {
    tool_name: String,
    cwd: PathBuf,
    parsed: Value,
}

pub(in crate::runtime) fn tool_validate_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ToolValidateParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    match validate_runtime_tool_call(&params.tool_name, params.cwd, &params.parsed) {
        Ok(()) => create_json_rpc_success(id, json!({ "status": "valid" })),
        Err(error) => create_json_rpc_success(
            id,
            json!({
                "status": "error",
                "message": error,
            }),
        ),
    }
}
