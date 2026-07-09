use serde::{Deserialize, Deserializer, Serialize};

pub const AGENT_TO_AGENT_PROTOCOL_VERSION: &str = "1.0";
pub const AGENT_TO_AGENT_AGENT_CARD_PATH: &str = "/.well-known/agent-card.json";

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push_notifications: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extended_agent_card: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions: Vec<AgentToAgentExtension>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentExtension {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_modes: Option<Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentInterface {
    pub url: String,
    pub protocol_binding: String,
    pub protocol_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentCard {
    pub name: String,
    pub description: String,
    pub version: String,
    pub supported_interfaces: Vec<AgentToAgentInterface>,
    pub capabilities: AgentToAgentCapabilities,
    pub default_input_modes: Vec<String>,
    pub default_output_modes: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_null_vec")]
    pub skills: Vec<AgentToAgentSkill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<AgentToAgentProvider>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_schemes: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_requirements: Option<Vec<std::collections::BTreeMap<String, Vec<String>>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signatures: Option<Vec<serde_json::Value>>,
}

fn deserialize_null_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToAgentProvider {
    pub organization: String,
    pub url: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentToAgentCardInput {
    pub name: String,
    pub description: String,
    pub url: String,
    pub version: String,
    pub capabilities: AgentToAgentCapabilities,
    pub default_input_modes: Vec<String>,
    pub default_output_modes: Vec<String>,
    pub skills: Vec<AgentToAgentSkill>,
}

pub fn create_agent_card(input: AgentToAgentCardInput) -> AgentToAgentCard {
    AgentToAgentCard {
        name: input.name,
        description: input.description,
        version: input.version,
        supported_interfaces: vec![AgentToAgentInterface {
            url: input.url,
            protocol_binding: "JSONRPC".to_owned(),
            protocol_version: AGENT_TO_AGENT_PROTOCOL_VERSION.to_owned(),
            tenant: None,
        }],
        capabilities: input.capabilities,
        default_input_modes: input.default_input_modes,
        default_output_modes: input.default_output_modes,
        skills: input.skills,
        provider: None,
        documentation_url: None,
        icon_url: None,
        security_schemes: None,
        security_requirements: None,
        signatures: None,
    }
}

pub fn is_valid_agent_card(card: &AgentToAgentCard) -> bool {
    card.supported_interfaces
        .iter()
        .any(|interface| interface.protocol_version == AGENT_TO_AGENT_PROTOCOL_VERSION)
        && !card.name.is_empty()
        && !card.description.is_empty()
        && !card.supported_interfaces.is_empty()
        && card
            .capabilities
            .extensions
            .iter()
            .all(|extension| !extension.uri.is_empty())
        && card
            .supported_interfaces
            .iter()
            .all(|interface| !interface.url.is_empty() && !interface.protocol_binding.is_empty())
        && !card.version.is_empty()
        && !card.default_input_modes.is_empty()
        && !card.default_output_modes.is_empty()
        && !card.skills.is_empty()
}
