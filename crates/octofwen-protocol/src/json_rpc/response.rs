use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    error::JsonRpcErrorObject,
    request::{JSON_RPC_VERSION, JsonRpcId},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcResponse {
    Success {
        jsonrpc: &'static str,
        id: JsonRpcId,
        result: Value,
    },
    Error {
        jsonrpc: &'static str,
        id: JsonRpcId,
        error: JsonRpcErrorObject,
    },
}

pub fn create_json_rpc_success(id: JsonRpcId, result: Value) -> JsonRpcResponse {
    JsonRpcResponse::Success {
        jsonrpc: JSON_RPC_VERSION,
        id,
        result,
    }
}

pub fn create_json_rpc_error(
    id: JsonRpcId,
    code: i64,
    message: impl Into<String>,
    data: Option<Value>,
) -> JsonRpcResponse {
    JsonRpcResponse::Error {
        jsonrpc: JSON_RPC_VERSION,
        id,
        error: JsonRpcErrorObject {
            code,
            message: message.into(),
            data,
        },
    }
}
