#![allow(
    clippy::result_large_err,
    reason = "JSON-RPC handlers propagate complete error responses so callers can preserve protocol ids and error payloads."
)]

use crate::rendering_model::build_tool_call_render_model;
use octofwen_protocol::a2a::{AgentToAgentMessage, AgentToAgentMessageRole, AgentToAgentPart};
use octofwen_protocol::acp::{
    AGENT_CLIENT_PROTOCOL_VERSION, AgentClientNewSessionRequest, AgentClientPromptRequest,
};
use octofwen_protocol::json_rpc::{
    JSON_RPC_VERSION, JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Write};

mod autofix;
mod compaction_decision;
mod config;
mod conversation_history;
mod dispatch;
mod input_history;
mod model;
mod octo_lower;
mod provider;
mod provider_plan;
mod quota;
mod reasoning;
mod skill_discovery;
mod sse;
mod synthetic_quota;
mod system_prompt;
mod tool;
mod trajectory;
mod transport;
mod update_notifications;
use compaction_decision::{
    compaction_checkpoint_content_response, compaction_decision_response,
    compaction_prepare_response,
};
use octo_lower::octo_lower_response;
use provider::provider_compiler_complete_response;
use skill_discovery::skill_discover_response;
use system_prompt::system_prompt_response;
use trajectory::trajectory_arc_result_from_value;

pub const A2A_SEND_MESSAGE_METHOD: &str = "SendMessage";
pub const A2A_GET_TASK_METHOD: &str = "GetTask";
pub const ACP_INITIALIZE_METHOD: &str = "initialize";
pub const ACP_SESSION_NEW_METHOD: &str = "session/new";
pub const ACP_SESSION_PROMPT_METHOD: &str = "session/prompt";
pub const AGENTD_INITIALIZE_METHOD: &str = "octofwen.agentd/initialize";
pub const AGENTD_INPUT_HISTORY_LOAD_METHOD: &str = "octofwen.agentd/inputHistoryLoad";
pub const AGENTD_INPUT_HISTORY_APPEND_METHOD: &str = "octofwen.agentd/inputHistoryAppend";
pub const AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD: &str = "octofwen.agentd/updateNotificationsRead";
pub const AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD: &str =
    "octofwen.agentd/updateNotificationsMarkSeen";
pub const AGENTD_CONVERSATION_HISTORY_APPEND_METHOD: &str =
    "octofwen.agentd/conversationHistoryAppend";
pub const AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD: &str =
    "octofwen.agentd/conversationHistoryRecords";
pub const AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD: &str =
    "octofwen.agentd/conversationHistoryLlmPayloads";
pub const AGENTD_TRAJECTORY_ARC_METHOD: &str = "octofwen.agentd/trajectoryArc";
pub const AGENTD_TRAJECTORY_FINISH_METHOD: &str = "octofwen.agentd/trajectoryFinish";
pub const AGENTD_SYSTEM_PROMPT_METHOD: &str = "octofwen.agentd/systemPrompt";
pub const AGENTD_COMPACTION_DECISION_METHOD: &str = "octofwen.agentd/compactionDecision";
pub const AGENTD_COMPACTION_PREPARE_METHOD: &str = "octofwen.agentd/compactionPrepare";
pub const AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD: &str =
    "octofwen.agentd/compactionCheckpointContent";
pub const AGENTD_CONFIG_MIGRATE_METHOD: &str = "octofwen.agentd/configMigrate";
pub const AGENTD_CONFIG_SANITIZE_METHOD: &str = "octofwen.agentd/configSanitize";
pub const AGENTD_CONFIG_KEY_FOR_MODEL_METHOD: &str = "octofwen.agentd/configKeyForModel";
pub const AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD: &str = "octofwen.agentd/configKeyForBaseUrl";
pub const AGENTD_CONFIG_SEARCH_METHOD: &str = "octofwen.agentd/configSearch";
pub const AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD: &str = "octofwen.agentd/configHasExistingKey";
pub const AGENTD_CONFIG_WRITE_KEY_METHOD: &str = "octofwen.agentd/configWriteKey";
pub const AGENTD_CONFIG_MERGE_ENV_VAR_METHOD: &str = "octofwen.agentd/configMergeEnvVar";
pub const AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD: &str =
    "octofwen.agentd/configMergeAutofixEnvVar";
pub const AGENTD_CONFIG_AUTOFIX_KEYS_METHOD: &str = "octofwen.agentd/configAutofixKeys";
pub const AGENTD_CONFIG_DEFAULT_PATHS_METHOD: &str = "octofwen.agentd/configDefaultPaths";
pub const AGENTD_CONFIG_RUN_NOTIFY_METHOD: &str = "octofwen.agentd/configRunNotify";
pub const AGENTD_CONFIG_SELECT_MODEL_METHOD: &str = "octofwen.agentd/configSelectModel";
pub const AGENTD_AUTOFIX_JSON_METHOD: &str = "octofwen.agentd/autofixJson";
pub const AGENTD_AUTOFIX_EDIT_METHOD: &str = "octofwen.agentd/autofixEdit";
pub const AGENTD_OCTO_LOWER_METHOD: &str = "octofwen.agentd/octoLower";
pub const AGENTD_RENDER_TOOL_CALL_METHOD: &str = "octofwen.agentd/renderToolCall";
pub const AGENTD_TOOL_DEFINITIONS_METHOD: &str = "octofwen.agentd/toolDefinitions";
pub const AGENTD_TOOL_RUN_METHOD: &str = "octofwen.agentd/toolRun";
pub const AGENTD_TOOL_PERMISSION_METHOD: &str = "octofwen.agentd/toolPermission";
pub const AGENTD_TOOL_VALIDATE_METHOD: &str = "octofwen.agentd/toolValidate";
pub const AGENTD_TRANSPORT_LOCAL_METHOD: &str = "octofwen.agentd/transportLocal";
pub const AGENTD_TRANSPORT_DOCKER_METHOD: &str = "octofwen.agentd/transportDocker";
pub const AGENTD_TRANSPORT_SSH_METHOD: &str = "octofwen.agentd/transportSsh";
pub const AGENTD_TRANSPORT_FIND_FILES_METHOD: &str = "octofwen.agentd/transportFindFiles";
pub const AGENTD_TRANSPORT_GET_ENV_METHOD: &str = "octofwen.agentd/transportGetEnv";
pub const AGENTD_TRANSPORT_DOCKER_RUN_METHOD: &str = "octofwen.agentd/transportDockerRun";
pub const AGENTD_TRANSPORT_DOCKER_KILL_METHOD: &str = "octofwen.agentd/transportDockerKill";
pub const AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD: &str =
    "octofwen.agentd/providerCompilerComplete";
pub const AGENTD_MODEL_PROVIDER_CATALOG_METHOD: &str = "octofwen.agentd/modelProviderCatalog";
pub const AGENTD_MODEL_PROVIDER_KEY_FROM_NAME_METHOD: &str =
    "octofwen.agentd/modelProviderKeyFromName";
pub const AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD: &str =
    "octofwen.agentd/modelProviderForBaseUrl";
pub const AGENTD_MODEL_RECOMMENDED_MODEL_METHOD: &str = "octofwen.agentd/modelRecommendedModel";
pub const AGENTD_MODEL_CONNECTION_TEST_METHOD: &str = "octofwen.agentd/modelConnectionTest";
pub const AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD: &str = "octofwen.agentd/syntheticQuotaFetch";
pub const AGENTD_SKILL_DISCOVER_METHOD: &str = "octofwen.agentd/skillDiscover";

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

type AgentdJsonRpcHandlerState<'a> = Option<&'a mut AgentdJsonRpcHandler>;
type AgentdJsonRpcHandlerView<'a> = Option<&'a AgentdJsonRpcHandler>;

#[derive(Default)]
pub struct AgentdJsonRpcHandler {
    acp_sessions: HashSet<String>,
    a2a_tasks: HashMap<String, Value>,
}

impl AgentdJsonRpcHandler {
    pub fn handle_line(&mut self, line: &str) -> Option<String> {
        dispatch::handle_agentd_json_rpc_line_with_state(line, Some(self))
    }
}

#[derive(Debug, Deserialize)]
struct AgentdRequest {
    jsonrpc: String,
    #[serde(default)]
    id: Option<JsonRpcId>,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderToolCallParams {
    name: String,
    arguments: Value,
}

pub fn handle_agentd_json_rpc_line(line: &str) -> Option<String> {
    dispatch::handle_agentd_json_rpc_line_with_state(line, None)
}

pub fn run_agentd_jsonl(
    reader: impl BufRead,
    mut writer: impl Write,
) -> Result<(), std::io::Error> {
    let mut handler = AgentdJsonRpcHandler::default();
    for line in reader.lines() {
        let line = line?;
        if let Some(response) = handler.handle_line(&line) {
            writeln!(writer, "{response}")?;
            writer.flush()?;
        }
    }
    Ok(())
}

fn a2a_send_message_response(
    id: JsonRpcId,
    params: Option<Value>,
    state: AgentdJsonRpcHandlerState<'_>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Some(message_value) = params.get("message").cloned() else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(message) = serde_json::from_value::<AgentToAgentMessage>(message_value) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let trajectory = match octofwen_trajectory_arc_result(&params) {
        Ok(value) => value,
        Err(response) => return response.with_id(id),
    };
    let response = AgentToAgentMessage {
        role: AgentToAgentMessageRole::Agent,
        message_id: format!("{}:response", message.message_id),
        parts: vec![AgentToAgentPart::text(a2a_response_text(
            trajectory.as_ref(),
        ))],
        context_id: message.context_id.clone(),
        task_id: message.task_id.clone(),
        metadata: None,
        extensions: Vec::new(),
        reference_task_ids: Vec::new(),
    };
    if let Some(state) = state {
        let task_id = message
            .task_id
            .clone()
            .unwrap_or_else(|| format!("octofwen:{}", message.message_id));
        let context_id = message
            .context_id
            .clone()
            .unwrap_or_else(|| task_id.clone());
        state.a2a_tasks.insert(
            task_id.clone(),
            json!({
                "id": task_id,
                "contextId": context_id,
                "status": { "state": "TASK_STATE_COMPLETED", "message": response },
                "history": [message],
                "metadata": trajectory_metadata(trajectory.as_ref()),
            }),
        );
    }
    let mut result = json!({ "message": response });
    if let Some(trajectory) = trajectory {
        result["octofwenTrajectory"] = trajectory;
    }
    create_json_rpc_success(id, result)
}

fn a2a_get_task_response(
    id: JsonRpcId,
    params: Option<Value>,
    state: AgentdJsonRpcHandlerView<'_>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Some(task_id) = params.get("id").and_then(Value::as_str) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Some(task) = state.and_then(|state| state.a2a_tasks.get(task_id)) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Unknown task", None);
    };
    create_json_rpc_success(id, json!({ "task": task }))
}

fn acp_initialize_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let protocol_version = params
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .unwrap_or(u64::from(AGENT_CLIENT_PROTOCOL_VERSION));
    if protocol_version != u64::from(AGENT_CLIENT_PROTOCOL_VERSION) {
        return create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Unsupported ACP protocol version",
            Some(json!({ "supportedProtocolVersion": AGENT_CLIENT_PROTOCOL_VERSION })),
        );
    }
    create_json_rpc_success(
        id,
        json!({
            "protocolVersion": AGENT_CLIENT_PROTOCOL_VERSION,
            "agentCapabilities": {
                "loadSession": false,
            },
            "agentInfo": {
                "name": "octofwen-agentd",
                "version": env!("CARGO_PKG_VERSION"),
            },
        }),
    )
}

fn acp_session_new_response(
    id: JsonRpcId,
    params: Option<Value>,
    state: AgentdJsonRpcHandlerState<'_>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<AgentClientNewSessionRequest>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    if !params.cwd.starts_with('/') {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    }
    let session_id = format!("octofwen:{}", params.cwd);
    if let Some(state) = state {
        state.acp_sessions.insert(session_id.clone());
    }
    create_json_rpc_success(
        id,
        json!({
            "sessionId": session_id,
        }),
    )
}

fn acp_session_prompt_response(
    id: JsonRpcId,
    params: Option<Value>,
    state: AgentdJsonRpcHandlerView<'_>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let trajectory = match octofwen_trajectory_arc_result(&params) {
        Ok(value) => value,
        Err(response) => return response.with_id(id),
    };
    let Ok(params) = serde_json::from_value::<AgentClientPromptRequest>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    if state.is_some_and(|state| !state.acp_sessions.contains(&params.session_id)) {
        return create_json_rpc_error(id, INVALID_PARAMS, "Unknown session", None);
    }
    let mut result = json!({ "stopReason": "end_turn" });
    if let Some(trajectory) = trajectory {
        result["octofwenTrajectory"] = trajectory;
    }
    create_json_rpc_success(id, result)
}

fn octofwen_trajectory_arc_result(params: &Value) -> Result<Option<Value>, JsonRpcResponse> {
    let Some(trajectory_params) = params
        .get("octofwenTrajectory")
        .or_else(|| params.pointer("/_meta/octofwen/trajectoryArc"))
        .cloned()
    else {
        return Ok(None);
    };
    trajectory_arc_result_from_value(trajectory_params).map(Some)
}

trait JsonRpcResponseIdExt {
    fn with_id(self, id: JsonRpcId) -> JsonRpcResponse;
}

impl JsonRpcResponseIdExt for JsonRpcResponse {
    fn with_id(self, id: JsonRpcId) -> JsonRpcResponse {
        match self {
            JsonRpcResponse::Success { result, .. } => create_json_rpc_success(id, result),
            JsonRpcResponse::Error { error, .. } => JsonRpcResponse::Error {
                jsonrpc: JSON_RPC_VERSION,
                id,
                error,
            },
        }
    }
}

fn a2a_response_text(trajectory: Option<&Value>) -> String {
    let Some(trajectory) = trajectory else {
        return "Accepted by octofwen-agentd".to_owned();
    };
    let reason_type = trajectory
        .get("reason")
        .and_then(|reason| reason.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    format!("octofwen trajectory finished with {reason_type}")
}

fn trajectory_metadata(trajectory: Option<&Value>) -> Value {
    trajectory
        .map(|trajectory| json!({ "octofwenTrajectory": trajectory }))
        .unwrap_or_else(|| json!({}))
}

fn initialize_result() -> Value {
    json!({
        "serverInfo": {
            "name": "octofwen-agentd",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": {
            "renderModels": true,
        },
    })
}

fn render_tool_call_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<RenderToolCallParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let render_model = build_tool_call_render_model(&params.name, params.arguments);
    match serde_json::to_value(render_model) {
        Ok(result) => create_json_rpc_success(id, result),
        Err(error) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Invalid params",
            Some(json!({ "message": error.to_string() })),
        ),
    }
}

fn serialize_response(response: JsonRpcResponse) -> String {
    serde_json::to_string(&response).unwrap_or_else(|_| {
        json!({
            "jsonrpc": "2.0",
            "id": Value::Null,
            "error": {
                "code": -32603,
                "message": "Internal error",
            },
        })
        .to_string()
    })
}
