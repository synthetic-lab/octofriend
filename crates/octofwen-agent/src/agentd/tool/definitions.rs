use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use octofwen_tools::runtime::{BuiltInToolDefinitionsInput, built_in_tool_definitions};
use octofwen_tools::skills::AgentSkill;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolDefinitionsParams {
    has_mcp_servers: bool,
    has_web_search: bool,
    #[serde(default)]
    skills: Vec<ToolDefinitionsSkill>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolDefinitionsSkill {
    name: String,
    description: String,
    license: Option<String>,
    compatibility: Option<String>,
    #[serde(default)]
    metadata: BTreeMap<String, String>,
    instructions: String,
    path: String,
    skill_file_path: String,
}

impl From<ToolDefinitionsSkill> for AgentSkill {
    fn from(skill: ToolDefinitionsSkill) -> Self {
        Self {
            name: skill.name,
            description: skill.description,
            license: skill.license,
            compatibility: skill.compatibility,
            metadata: skill.metadata,
            instructions: skill.instructions,
            path: skill.path,
            skill_file_path: skill.skill_file_path,
        }
    }
}

pub(in crate::agentd) fn tool_definitions_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ToolDefinitionsParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let tools = built_in_tool_definitions(BuiltInToolDefinitionsInput {
        has_mcp_servers: params.has_mcp_servers,
        has_web_search: params.has_web_search,
        skills: params.skills.into_iter().map(Into::into).collect(),
    })
    .into_iter()
    .map(|definition| {
        json!({
            "name": definition.name,
            "description": definition.description,
            "argumentsSchema": definition.arguments_schema,
        })
    })
    .collect::<Vec<_>>();

    create_json_rpc_success(id, json!({ "tools": tools }))
}
