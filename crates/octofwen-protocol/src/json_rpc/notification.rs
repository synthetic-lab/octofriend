use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::request::JSON_RPC_VERSION;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: &'static str,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

pub fn create_json_rpc_notification(
    method: impl Into<String>,
    params: Option<Value>,
) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: JSON_RPC_VERSION,
        method: method.into(),
        params,
    }
}
