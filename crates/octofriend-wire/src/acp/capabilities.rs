use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientFileSystemCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_text_file: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_text_file: Option<bool>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs: Option<AgentClientFileSystemCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<AgentClientSessionCapabilities>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Map<String, Value>>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_options: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Map<String, Value>>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientAgentCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub load_session: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_capabilities: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_capabilities: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_capabilities: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Map<String, Value>>,
}
