use serde::{Deserialize, Deserializer, Serialize, Serializer, de, ser::SerializeSeq};
use serde_json::{Value, json};

use super::session::{AgentClientContentBlock, AgentClientMeta};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientToolCallUpdate {
    pub tool_call_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<AgentClientToolCallStatus>,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        serialize_with = "serialize_tool_call_content_blocks",
        deserialize_with = "deserialize_tool_call_content_blocks"
    )]
    pub content: Vec<AgentClientContentBlock>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locations: Vec<AgentClientToolCallLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

impl AgentClientToolCallUpdate {
    pub fn new(tool_call_id: impl Into<String>) -> Self {
        Self {
            tool_call_id: tool_call_id.into(),
            title: None,
            kind: None,
            status: None,
            content: Vec::new(),
            locations: Vec::new(),
            raw_input: None,
            raw_output: None,
            meta: None,
        }
    }
}

fn serialize_tool_call_content_blocks<S>(
    content: &[AgentClientContentBlock],
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let mut seq = serializer.serialize_seq(Some(content.len()))?;
    for block in content {
        seq.serialize_element(&json!({
            "type": "content",
            "content": block,
        }))?;
    }
    seq.end()
}

fn deserialize_tool_call_content_blocks<'de, D>(
    deserializer: D,
) -> Result<Vec<AgentClientContentBlock>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = Vec::<Value>::deserialize(deserializer)?;
    let mut content = Vec::with_capacity(values.len());
    for value in values {
        let block_value = value
            .get("type")
            .and_then(Value::as_str)
            .filter(|content_type| *content_type == "content")
            .and_then(|_| value.get("content"))
            .cloned()
            .unwrap_or(value);
        content.push(AgentClientContentBlock::deserialize(block_value).map_err(de::Error::custom)?);
    }
    Ok(content)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientToolCallLocation {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing)]
    pub column: Option<u32>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub meta: Option<AgentClientMeta>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentClientToolCallStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}
