use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const JSON_RPC_VERSION: &str = "2.0";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcId {
    String(String),
    Number(i64),
    Null,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub id: JsonRpcId,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JsonRpcMessageKind {
    Request,
    Notification,
    Response,
}

pub fn create_json_rpc_request(
    id: JsonRpcId,
    method: impl Into<String>,
    params: Option<Value>,
) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: JSON_RPC_VERSION,
        id,
        method: method.into(),
        params,
    }
}

pub fn classify_json_rpc_message(value: &Value) -> Option<JsonRpcMessageKind> {
    let object = value.as_object()?;
    if object.get("jsonrpc")?.as_str()? != JSON_RPC_VERSION {
        return None;
    }

    let has_id = object.contains_key("id");
    let has_method = object.contains_key("method");
    let has_response_body = object.contains_key("result") || object.contains_key("error");

    match (has_id, has_method, has_response_body) {
        (true, true, _) => Some(JsonRpcMessageKind::Request),
        (false, true, _) => Some(JsonRpcMessageKind::Notification),
        (true, false, true) => Some(JsonRpcMessageKind::Response),
        _ => None,
    }
}
