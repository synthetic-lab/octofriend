use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use serde_json::{Value, json};

use crate::json_rpc::{JsonRpcId, JsonRpcRequest, create_json_rpc_request};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AgentToAgentMessageRole {
    #[serde(rename = "ROLE_UNSPECIFIED")]
    Unspecified,
    #[serde(rename = "ROLE_USER")]
    User,
    #[serde(rename = "ROLE_AGENT")]
    Agent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Map<String, Value>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentToAgentPartWire {
    text: Option<String>,
    raw: Option<String>,
    url: Option<String>,
    data: Option<Value>,
    filename: Option<String>,
    media_type: Option<String>,
    metadata: Option<serde_json::Map<String, Value>>,
}

impl<'de> Deserialize<'de> for AgentToAgentPart {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let part = AgentToAgentPartWire::deserialize(deserializer)?;
        let content_field_count = [
            part.text.is_some(),
            part.raw.is_some(),
            part.url.is_some(),
            part.data.is_some(),
        ]
        .into_iter()
        .filter(|present| *present)
        .count();
        if content_field_count != 1 {
            return Err(de::Error::custom(
                "expected exactly one of text, raw, url, or data",
            ));
        }
        Ok(Self {
            text: part.text,
            raw: part.raw,
            url: part.url,
            data: part.data,
            filename: part.filename,
            media_type: part.media_type,
            metadata: part.metadata,
        })
    }
}

impl AgentToAgentPart {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: Some(text.into()),
            raw: None,
            url: None,
            data: None,
            filename: None,
            media_type: None,
            metadata: None,
        }
    }

    pub fn raw(raw: impl AsRef<[u8]>) -> Self {
        Self {
            text: None,
            raw: Some(STANDARD.encode(raw.as_ref())),
            url: None,
            data: None,
            filename: None,
            media_type: None,
            metadata: None,
        }
    }

    pub fn base64_raw(raw: impl Into<String>) -> Self {
        Self {
            text: None,
            raw: Some(raw.into()),
            url: None,
            data: None,
            filename: None,
            media_type: None,
            metadata: None,
        }
    }

    pub fn url(url: impl Into<String>) -> Self {
        Self {
            text: None,
            raw: None,
            url: Some(url.into()),
            data: None,
            filename: None,
            media_type: None,
            metadata: None,
        }
    }

    pub fn data(data: Value) -> Self {
        Self {
            text: None,
            raw: None,
            url: None,
            data: Some(data),
            filename: None,
            media_type: None,
            metadata: None,
        }
    }
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
    pub message_id: String,
    pub parts: Vec<AgentToAgentPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reference_task_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentSendMessageConfiguration {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_immediately: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_length: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accepted_output_modes: Vec<String>,
    #[serde(
        alias = "pushNotificationConfig",
        skip_serializing_if = "Option::is_none"
    )]
    pub task_push_notification_config: Option<Value>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AgentToAgentTaskState {
    #[serde(rename = "TASK_STATE_UNSPECIFIED")]
    Unspecified,
    #[serde(rename = "TASK_STATE_SUBMITTED")]
    Submitted,
    #[serde(rename = "TASK_STATE_WORKING")]
    Working,
    #[serde(rename = "TASK_STATE_INPUT_REQUIRED")]
    InputRequired,
    #[serde(rename = "TASK_STATE_COMPLETED")]
    Completed,
    #[serde(rename = "TASK_STATE_CANCELED")]
    Canceled,
    #[serde(rename = "TASK_STATE_FAILED")]
    Failed,
    #[serde(rename = "TASK_STATE_REJECTED")]
    Rejected,
    #[serde(rename = "TASK_STATE_AUTH_REQUIRED")]
    AuthRequired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentTaskStatus {
    pub state: AgentToAgentTaskState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<AgentToAgentMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentArtifact {
    pub artifact_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<AgentToAgentPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentTask {
    pub id: String,
    pub context_id: String,
    pub status: AgentToAgentTaskStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<AgentToAgentArtifact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<AgentToAgentMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Map<String, Value>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentTaskStatusUpdateEvent {
    pub task_id: String,
    pub context_id: String,
    pub status: AgentToAgentTaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Map<String, Value>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentTaskArtifactUpdateEvent {
    pub task_id: String,
    pub context_id: String,
    pub artifact: AgentToAgentArtifact,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub append: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_chunk: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Map<String, Value>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AgentToAgentStreamResponse {
    Task(AgentToAgentTask),
    Message(AgentToAgentMessage),
    StatusUpdate(AgentToAgentTaskStatusUpdateEvent),
    ArtifactUpdate(AgentToAgentTaskArtifactUpdateEvent),
}

impl Serialize for AgentToAgentStreamResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Task(task) => json!({ "task": task }).serialize(serializer),
            Self::Message(message) => json!({ "message": message }).serialize(serializer),
            Self::StatusUpdate(event) => json!({ "statusUpdate": event }).serialize(serializer),
            Self::ArtifactUpdate(event) => json!({ "artifactUpdate": event }).serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for AgentToAgentStreamResponse {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = serde_json::Map::<String, Value>::deserialize(deserializer)?;
        if let Some(value) = raw.get("message") {
            return serde_json::from_value(value.clone())
                .map(Self::Message)
                .map_err(de::Error::custom);
        }
        if let Some(value) = raw.get("task") {
            return serde_json::from_value(value.clone())
                .map(Self::Task)
                .map_err(de::Error::custom);
        }
        if let Some(value) = raw.get("statusUpdate") {
            return serde_json::from_value(value.clone())
                .map(Self::StatusUpdate)
                .map_err(de::Error::custom);
        }
        if let Some(value) = raw.get("artifactUpdate") {
            return serde_json::from_value(value.clone())
                .map(Self::ArtifactUpdate)
                .map_err(de::Error::custom);
        }
        Err(de::Error::custom(
            "expected task, message, statusUpdate, or artifactUpdate",
        ))
    }
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
    configuration: Option<AgentToAgentSendMessageConfiguration>,
) -> JsonRpcRequest {
    let mut params = serde_json::Map::new();
    params.insert("message".to_owned(), json!(message));
    if let Some(configuration) = configuration {
        params.insert("configuration".to_owned(), json!(configuration));
    }

    create_agent_to_agent_request(id, "SendMessage", Some(Value::Object(params)))
}
