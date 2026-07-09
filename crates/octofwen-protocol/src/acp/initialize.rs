use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::json_rpc::{JsonRpcId, JsonRpcRequest, create_json_rpc_request};

use super::capabilities::AgentClientAgentCapabilities;
use super::capabilities::AgentClientCapabilities;

pub const AGENT_CLIENT_PROTOCOL_VERSION: u16 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentClientPeerInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientInitializeParams {
    pub protocol_version: u16,
    pub client_capabilities: AgentClientCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_info: Option<AgentClientPeerInfo>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientInitializeResponse {
    pub protocol_version: u16,
    pub agent_capabilities: AgentClientAgentCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_info: Option<AgentClientPeerInfo>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub auth_methods: Vec<AgentClientAuthMethod>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentClientAuthMethod {
    Agent,
    EnvVar {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    Terminal,
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
            "clientCapabilities": input.capabilities,
        })),
    )
}

pub const fn is_agent_client_protocol_version(value: u16) -> bool {
    value == AGENT_CLIENT_PROTOCOL_VERSION
}
