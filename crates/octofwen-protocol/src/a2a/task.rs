use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::json_rpc::{JsonRpcId, JsonRpcRequest, create_json_rpc_request};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AgentToAgentMessageRole {
    #[serde(rename = "user")]
    User,
    #[serde(rename = "agent")]
    Agent,
    #[serde(rename = "ROLE_USER")]
    RoleUser,
    #[serde(rename = "ROLE_AGENT")]
    RoleAgent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentToAgentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "data")]
    Data {
        data: serde_json::Map<String, Value>,
    },
    #[serde(rename = "file")]
    File { file: AgentToAgentFilePart },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentFilePart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentMessage {
    pub role: AgentToAgentMessageRole,
    pub parts: Vec<AgentToAgentPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

pub fn create_agent_to_agent_request(
    id: JsonRpcId,
    method: impl Into<String>,
    params: Option<Value>,
) -> JsonRpcRequest {
    create_json_rpc_request(id, method, params)
}

pub fn create_send_message_request(
    id: JsonRpcId,
    message: AgentToAgentMessage,
    accepted_output_modes: Option<Vec<String>>,
    blocking: Option<bool>,
) -> JsonRpcRequest {
    let mut configuration = serde_json::Map::new();
    if let Some(modes) = accepted_output_modes {
        configuration.insert("acceptedOutputModes".to_owned(), json!(modes));
    }
    if let Some(blocking_value) = blocking {
        configuration.insert("blocking".to_owned(), json!(blocking_value));
    }

    let mut params = serde_json::Map::new();
    params.insert("message".to_owned(), json!(message));
    if !configuration.is_empty() {
        params.insert("configuration".to_owned(), Value::Object(configuration));
    }

    create_agent_to_agent_request(id, "SendMessage", Some(Value::Object(params)))
}
