use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::json_rpc::{JsonRpcId, JsonRpcRequest, create_json_rpc_request};

use super::capabilities::AgentClientCapabilities;

pub const AGENT_CLIENT_PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentClientPeerInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientInitializeParams {
    pub protocol_version: u8,
    pub client_info: AgentClientPeerInfo,
    pub capabilities: AgentClientCapabilities,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentClientInitializeInput {
    pub client_info: AgentClientPeerInfo,
    pub capabilities: AgentClientCapabilities,
}

pub fn create_agent_client_initialize_request(
    id: JsonRpcId,
    input: AgentClientInitializeInput,
) -> JsonRpcRequest {
    create_json_rpc_request(
        id,
        "initialize",
        Some(json!({
            "protocolVersion": AGENT_CLIENT_PROTOCOL_VERSION,
            "clientInfo": input.client_info,
            "capabilities": input.capabilities,
        })),
    )
}

pub const fn is_agent_client_protocol_version(value: u8) -> bool {
    value == AGENT_CLIENT_PROTOCOL_VERSION
}
