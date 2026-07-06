use serde::{Deserialize, Serialize};

pub const AGENT_TO_AGENT_PROTOCOL_VERSION: &str = "1.0.0";
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
pub struct AgentToAgentCard {
    pub protocol_version: String,
    pub name: String,
    pub description: String,
    pub url: String,
    pub version: String,
    pub capabilities: AgentToAgentCapabilities,
    pub default_input_modes: Vec<String>,
    pub default_output_modes: Vec<String>,
    pub skills: Vec<AgentToAgentSkill>,
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
        protocol_version: AGENT_TO_AGENT_PROTOCOL_VERSION.to_owned(),
        name: input.name,
        description: input.description,
        url: input.url,
        version: input.version,
        capabilities: input.capabilities,
        default_input_modes: input.default_input_modes,
        default_output_modes: input.default_output_modes,
        skills: input.skills,
    }
}

pub fn is_valid_agent_card(card: &AgentToAgentCard) -> bool {
    card.protocol_version == AGENT_TO_AGENT_PROTOCOL_VERSION
        && !card.name.is_empty()
        && !card.description.is_empty()
        && !card.url.is_empty()
        && !card.version.is_empty()
        && !card.default_input_modes.is_empty()
        && !card.default_output_modes.is_empty()
        && !card.skills.is_empty()
}
