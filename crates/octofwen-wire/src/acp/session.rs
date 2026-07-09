use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, json};

use crate::json_rpc::{JsonRpcId, JsonRpcRequest, create_json_rpc_request};

use super::tool_call::AgentClientToolCallUpdate;

pub type AgentClientMeta = serde_json::Map<String, Value>;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub enum AgentClientMaybeString {
    #[default]
    Undefined,
    Null,
    String(String),
}

impl AgentClientMaybeString {
    pub fn is_undefined(&self) -> bool {
        matches!(self, Self::Undefined)
    }

    pub fn null() -> Self {
        Self::Null
    }
}

impl From<String> for AgentClientMaybeString {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<&str> for AgentClientMaybeString {
    fn from(value: &str) -> Self {
        Self::String(value.to_owned())
    }
}

impl Serialize for AgentClientMaybeString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Undefined | Self::Null => serializer.serialize_none(),
            Self::String(value) => serializer.serialize_str(value),
        }
    }
}

impl<'de> Deserialize<'de> for AgentClientMaybeString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<String>::deserialize(deserializer)
            .map(|value| value.map_or(Self::Null, Self::String))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientNewSessionRequest {
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub additional_directories: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<AgentClientMcpServer>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientNewSessionRequest {
    pub fn new(cwd: impl Into<String>) -> Self {
        Self {
            cwd: cwd.into(),
            additional_directories: Vec::new(),
            mcp_servers: Vec::new(),
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientNewSessionResponse {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modes: Vec<AgentClientSessionMode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub config_options: Vec<AgentClientSessionConfigOption>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientNewSessionResponse {
    pub fn new(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            modes: Vec::new(),
            config_options: Vec::new(),
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionMode {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentClientMcpServer {
    Http(AgentClientHttpMcpServer),
    Sse(AgentClientHttpMcpServer),
    #[serde(untagged)]
    Stdio(AgentClientStdioMcpServer),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientHttpMcpServer {
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<AgentClientNameValue>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientHttpMcpServer {
    pub fn new(name: impl Into<String>, url: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            url: url.into(),
            headers: Vec::new(),
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientStdioMcpServer {
    pub name: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<AgentClientNameValue>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientStdioMcpServer {
    pub fn new(name: impl Into<String>, command: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            command: command.into(),
            args: Vec::new(),
            env: Vec::new(),
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientNameValue {
    pub name: String,
    pub value: String,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientNameValue {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentClientContentBlock {
    Text(AgentClientTextContent),
    ResourceLink(AgentClientResourceLink),
    Resource(AgentClientEmbeddedResource),
    Image(AgentClientImageContent),
    Audio(AgentClientAudioContent),
}

impl AgentClientContentBlock {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text(AgentClientTextContent {
            text: text.into(),
            annotations: None,
            meta: None,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientImageContent {
    pub data: String,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientImageContent {
    pub fn new(data: impl Into<String>, mime_type: impl Into<String>) -> Self {
        Self {
            data: data.into(),
            mime_type: mime_type.into(),
            uri: None,
            annotations: None,
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientAudioContent {
    pub data: String,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientAudioContent {
    pub fn new(data: impl Into<String>, mime_type: impl Into<String>) -> Self {
        Self {
            data: data.into(),
            mime_type: mime_type.into(),
            annotations: None,
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientResourceLink {
    pub name: String,
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientResourceLink {
    pub fn new(name: impl Into<String>, uri: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            uri: uri.into(),
            description: None,
            mime_type: None,
            size: None,
            title: None,
            annotations: None,
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientEmbeddedResource {
    pub resource: AgentClientEmbeddedResourceValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientEmbeddedResource {
    pub fn new(resource: AgentClientEmbeddedResourceValue) -> Self {
        Self {
            resource,
            annotations: None,
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AgentClientEmbeddedResourceValue {
    Text(AgentClientTextResourceContents),
    Blob(AgentClientBlobResourceContents),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientTextResourceContents {
    pub text: String,
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientBlobResourceContents {
    pub blob: String,
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentClientTextContent {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientPromptRequest {
    pub session_id: String,
    pub prompt: Vec<AgentClientContentBlock>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientPromptRequest {
    pub fn new(session_id: impl Into<String>, prompt: Vec<AgentClientContentBlock>) -> Self {
        Self {
            session_id: session_id.into(),
            prompt,
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientReadTextFileRequest {
    pub session_id: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientReadTextFileRequest {
    pub fn new(session_id: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            path: path.into(),
            line: None,
            limit: None,
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientWriteTextFileRequest {
    pub session_id: String,
    pub path: String,
    pub content: String,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientWriteTextFileRequest {
    pub fn new(
        session_id: impl Into<String>,
        path: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            path: path.into(),
            content: content.into(),
            meta: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientPermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: AgentClientPermissionOptionKind,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientPermissionOption {
    pub fn new(
        option_id: impl Into<String>,
        name: impl Into<String>,
        kind: AgentClientPermissionOptionKind,
    ) -> Self {
        Self {
            option_id: option_id.into(),
            name: name.into(),
            kind,
            meta: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentClientPermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientRequestPermissionRequest {
    pub session_id: String,
    pub tool_call: AgentClientToolCallUpdate,
    pub options: Vec<AgentClientPermissionOption>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientRequestPermissionRequest {
    pub fn new(
        session_id: impl Into<String>,
        tool_call: AgentClientToolCallUpdate,
        options: Vec<AgentClientPermissionOption>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            tool_call,
            options,
            meta: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionNotification {
    pub session_id: String,
    pub update: AgentClientSessionUpdate,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "sessionUpdate", rename_all = "snake_case")]
pub enum AgentClientSessionUpdate {
    UserMessageChunk(AgentClientContentChunk),
    AgentMessageChunk(AgentClientContentChunk),
    AgentThoughtChunk(AgentClientContentChunk),
    ToolCall(AgentClientToolCallUpdate),
    ToolCallUpdate(AgentClientToolCallUpdate),
    Plan(AgentClientPlan),
    AvailableCommandsUpdate(AgentClientAvailableCommandsUpdate),
    CurrentModeUpdate(AgentClientCurrentModeUpdate),
    ConfigOptionUpdate(AgentClientConfigOptionUpdate),
    SessionInfoUpdate(AgentClientSessionInfoUpdate),
    UsageUpdate(AgentClientUsageUpdate),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientPlan {
    pub entries: Vec<AgentClientPlanEntry>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientPlanEntry {
    pub content: String,
    pub priority: AgentClientPlanEntryPriority,
    pub status: AgentClientPlanEntryStatus,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentClientPlanEntryPriority {
    High,
    Medium,
    Low,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentClientPlanEntryStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientAvailableCommandsUpdate {
    pub available_commands: Vec<AgentClientAvailableCommand>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientAvailableCommand {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientCurrentModeUpdate {
    pub current_mode_id: String,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientConfigOptionUpdate {
    pub config_options: Vec<AgentClientSessionConfigOption>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionConfigOption {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub kind: AgentClientSessionConfigKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<AgentClientSessionConfigOptionCategory>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentClientSessionConfigKind {
    Select(AgentClientSessionConfigSelect),
    Boolean(AgentClientSessionConfigBoolean),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionConfigSelect {
    pub current_value: String,
    pub options: Vec<AgentClientSessionConfigSelectOption>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionConfigSelectOption {
    pub value: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionConfigBoolean {
    pub current_value: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentClientSessionConfigOptionCategory {
    Mode,
    Model,
    ModelConfig,
    ThoughtLevel,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientSessionInfoUpdate {
    #[serde(default, skip_serializing_if = "AgentClientMaybeString::is_undefined")]
    pub title: AgentClientMaybeString,
    #[serde(default, skip_serializing_if = "AgentClientMaybeString::is_undefined")]
    pub updated_at: AgentClientMaybeString,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientUsageUpdate {
    pub used: u64,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<AgentClientCost>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientCost {
    pub amount: f64,
    pub currency: String,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientContentChunk {
    pub content: AgentClientContentBlock,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

pub fn create_agent_client_new_session_request(
    id: JsonRpcId,
    params: AgentClientNewSessionRequest,
) -> JsonRpcRequest {
    create_json_rpc_request(id, "session/new", Some(json!(params)))
}

pub fn create_agent_client_prompt_request(
    id: JsonRpcId,
    params: AgentClientPromptRequest,
) -> JsonRpcRequest {
    create_json_rpc_request(id, "session/prompt", Some(json!(params)))
}

pub fn create_agent_client_read_text_file_request(
    id: JsonRpcId,
    params: AgentClientReadTextFileRequest,
) -> JsonRpcRequest {
    create_json_rpc_request(id, "fs/read_text_file", Some(json!(params)))
}

pub fn create_agent_client_write_text_file_request(
    id: JsonRpcId,
    params: AgentClientWriteTextFileRequest,
) -> JsonRpcRequest {
    create_json_rpc_request(id, "fs/write_text_file", Some(json!(params)))
}

pub fn create_agent_client_request_permission_request(
    id: JsonRpcId,
    params: AgentClientRequestPermissionRequest,
) -> JsonRpcRequest {
    create_json_rpc_request(id, "session/request_permission", Some(json!(params)))
}

pub fn create_agent_client_session_notification(
    session_id: impl Into<String>,
    update: AgentClientSessionUpdate,
) -> AgentClientSessionNotification {
    AgentClientSessionNotification {
        session_id: session_id.into(),
        update,
        meta: None,
    }
}
