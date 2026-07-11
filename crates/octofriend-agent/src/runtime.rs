#![allow(
    clippy::result_large_err,
    reason = "JSON-RPC handlers propagate complete error responses so callers can preserve protocol ids and error payloads."
)]

use crate::rendering_model::build_tool_call_render_model;
use octofriend_wire::a2a::{AgentToAgentMessage, AgentToAgentMessageRole, AgentToAgentPart};
use octofriend_wire::acp::{
    AGENT_CLIENT_PROTOCOL_VERSION, AgentClientNewSessionRequest, AgentClientPromptRequest,
};
use octofriend_wire::json_rpc::{
    JSON_RPC_VERSION, JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Write};

#[path = "autofix.rs"]
mod autofix;
#[path = "catalog.rs"]
mod catalog;
#[path = "compaction.rs"]
mod compaction;
#[path = "config.rs"]
mod config;
#[path = "dispatch.rs"]
mod dispatch;
#[path = "event_stream.rs"]
mod event_stream;
#[path = "history.rs"]
mod history;
#[path = "input.rs"]
mod input;
#[path = "model_plan.rs"]
mod model_plan;
#[path = "octofriend.rs"]
mod octofriend;
#[path = "quota.rs"]
mod quota;
#[path = "reasoning.rs"]
mod reasoning;
#[path = "run_log.rs"]
mod run_log;
#[path = "skills.rs"]
mod skills;
#[path = "stream.rs"]
mod stream;
#[path = "synthetic_quota.rs"]
mod synthetic_quota;
#[path = "system_prompt.rs"]
mod system_prompt;
#[path = "tools.rs"]
mod tools;
#[path = "transport.rs"]
mod transport;
#[path = "updates.rs"]
mod updates;
use compaction::{
    compaction_checkpoint_content_response, compaction_decision_response,
    compaction_prepare_response,
};
use octofriend::octo_lower_response;
use run_log::trajectory_arc_result_from_value;
use skills::skill_discover_response;
use stream::provider_compiler_complete_response;
use system_prompt::system_prompt_response;

pub const A2A_SEND_MESSAGE_METHOD: &str = "SendMessage";
pub const A2A_GET_TASK_METHOD: &str = "GetTask";
pub const ACP_INITIALIZE_METHOD: &str = "initialize";
pub const ACP_SESSION_NEW_METHOD: &str = "session/new";
pub const ACP_SESSION_PROMPT_METHOD: &str = "session/prompt";
pub const AGENTD_INITIALIZE_METHOD: &str = "octofriend.agentd/initialize";
pub const AGENTD_INPUT_HISTORY_LOAD_METHOD: &str = "octofriend.agentd/inputHistoryLoad";
pub const AGENTD_INPUT_HISTORY_APPEND_METHOD: &str = "octofriend.agentd/inputHistoryAppend";
pub const AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD: &str =
    "octofriend.agentd/updateNotificationsRead";
pub const AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD: &str =
    "octofriend.agentd/updateNotificationsMarkSeen";
pub const AGENTD_CONVERSATION_HISTORY_APPEND_METHOD: &str =
    "octofriend.agentd/conversationHistoryAppend";
pub const AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD: &str =
    "octofriend.agentd/conversationHistoryRecords";
pub const AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD: &str =
    "octofriend.agentd/conversationHistoryLlmPayloads";
pub const AGENTD_TRAJECTORY_ARC_METHOD: &str = "octofriend.agentd/trajectoryArc";
pub const AGENTD_TRAJECTORY_FINISH_METHOD: &str = "octofriend.agentd/trajectoryFinish";
pub const AGENTD_SYSTEM_PROMPT_METHOD: &str = "octofriend.agentd/systemPrompt";
pub const AGENTD_COMPACTION_DECISION_METHOD: &str = "octofriend.agentd/compactionDecision";
pub const AGENTD_COMPACTION_PREPARE_METHOD: &str = "octofriend.agentd/compactionPrepare";
pub const AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD: &str =
    "octofriend.agentd/compactionCheckpointContent";
pub const AGENTD_CONFIG_MIGRATE_METHOD: &str = "octofriend.agentd/configMigrate";
pub const AGENTD_CONFIG_SANITIZE_METHOD: &str = "octofriend.agentd/configSanitize";
pub const AGENTD_CONFIG_KEY_FOR_MODEL_METHOD: &str = "octofriend.agentd/configKeyForModel";
pub const AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD: &str = "octofriend.agentd/configKeyForBaseUrl";
pub const AGENTD_CONFIG_SEARCH_METHOD: &str = "octofriend.agentd/configSearch";
pub const AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD: &str = "octofriend.agentd/configHasExistingKey";
pub const AGENTD_CONFIG_WRITE_KEY_METHOD: &str = "octofriend.agentd/configWriteKey";
pub const AGENTD_CONFIG_MERGE_ENV_VAR_METHOD: &str = "octofriend.agentd/configMergeEnvVar";
pub const AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD: &str =
    "octofriend.agentd/configMergeAutofixEnvVar";
pub const AGENTD_CONFIG_AUTOFIX_KEYS_METHOD: &str = "octofriend.agentd/configAutofixKeys";
pub const AGENTD_CONFIG_DEFAULT_PATHS_METHOD: &str = "octofriend.agentd/configDefaultPaths";
pub const AGENTD_CONFIG_RUN_NOTIFY_METHOD: &str = "octofriend.agentd/configRunNotify";
pub const AGENTD_CONFIG_SELECT_MODEL_METHOD: &str = "octofriend.agentd/configSelectModel";
pub const AGENTD_AUTOFIX_JSON_METHOD: &str = "octofriend.agentd/autofixJson";
pub const AGENTD_AUTOFIX_EDIT_METHOD: &str = "octofriend.agentd/autofixEdit";
pub const AGENTD_OCTO_LOWER_METHOD: &str = "octofriend.agentd/octoLower";
pub const AGENTD_RENDER_TOOL_CALL_METHOD: &str = "octofriend.agentd/renderToolCall";
pub const AGENTD_TOOL_DEFINITIONS_METHOD: &str = "octofriend.agentd/toolDefinitions";
pub const AGENTD_TOOL_RUN_METHOD: &str = "octofriend.agentd/toolRun";
pub const AGENTD_TOOL_PERMISSION_METHOD: &str = "octofriend.agentd/toolPermission";
pub const AGENTD_TOOL_VALIDATE_METHOD: &str = "octofriend.agentd/toolValidate";
pub const AGENTD_TRANSPORT_LOCAL_METHOD: &str = "octofriend.agentd/transportLocal";
pub const AGENTD_TRANSPORT_DOCKER_METHOD: &str = "octofriend.agentd/transportDocker";
pub const AGENTD_TRANSPORT_SSH_METHOD: &str = "octofriend.agentd/transportSsh";
pub const AGENTD_TRANSPORT_FIND_FILES_METHOD: &str = "octofriend.agentd/transportFindFiles";
pub const AGENTD_TRANSPORT_GET_ENV_METHOD: &str = "octofriend.agentd/transportGetEnv";
pub const AGENTD_TRANSPORT_DOCKER_RUN_METHOD: &str = "octofriend.agentd/transportDockerRun";
pub const AGENTD_TRANSPORT_DOCKER_KILL_METHOD: &str = "octofriend.agentd/transportDockerKill";
pub const AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD: &str =
    "octofriend.agentd/providerCompilerComplete";
pub const AGENTD_MODEL_PROVIDER_CATALOG_METHOD: &str = "octofriend.agentd/modelProviderCatalog";
pub const AGENTD_MODEL_PROVIDER_KEY_FROM_NAME_METHOD: &str =
    "octofriend.agentd/modelProviderKeyFromName";
pub const AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD: &str =
    "octofriend.agentd/modelProviderForBaseUrl";
pub const AGENTD_MODEL_RECOMMENDED_MODEL_METHOD: &str = "octofriend.agentd/modelRecommendedModel";
pub const AGENTD_MODEL_CONNECTION_TEST_METHOD: &str = "octofriend.agentd/modelConnectionTest";
pub const AGENTD_MODEL_DISCOVER_METHOD: &str = "octofriend.agentd/modelDiscover";
pub const AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD: &str = "octofriend.agentd/syntheticQuotaFetch";
pub const AGENTD_SKILL_DISCOVER_METHOD: &str = "octofriend.agentd/skillDiscover";

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
    let trajectory = match octofriend_trajectory_arc_result(&params) {
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
            .unwrap_or_else(|| format!("octofriend:{}", message.message_id));
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
        result["octofriendTrajectory"] = trajectory;
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
                "name": "octofriend-agentd",
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
    let session_id = format!("octofriend:{}", params.cwd);
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
    let trajectory = match octofriend_trajectory_arc_result(&params) {
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
        result["octofriendTrajectory"] = trajectory;
    }
    create_json_rpc_success(id, result)
}

fn octofriend_trajectory_arc_result(params: &Value) -> Result<Option<Value>, JsonRpcResponse> {
    let Some(trajectory_params) = params
        .get("octofriendTrajectory")
        .or_else(|| params.pointer("/_meta/octofriend/trajectoryArc"))
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
        return "Accepted by octofriend-agentd".to_owned();
    };
    let reason_type = trajectory
        .get("reason")
        .and_then(|reason| reason.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    format!("octofriend trajectory finished with {reason_type}")
}

fn trajectory_metadata(trajectory: Option<&Value>) -> Value {
    trajectory
        .map(|trajectory| json!({ "octofriendTrajectory": trajectory }))
        .unwrap_or_else(|| json!({}))
}

fn initialize_result() -> Value {
    json!({
        "serverInfo": {
            "name": "octofriend-agentd",
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
