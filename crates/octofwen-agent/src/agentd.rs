use crate::rendering_model::build_tool_call_render_model;
use octofwen_llm::compiler::AssistantOutputProvider;
use octofwen_llm::providers::anthropic::{
    AnthropicCurlRequest, AnthropicMessagesHttpRequestParams, anthropic_messages_curl,
    anthropic_messages_http_request,
};
use octofwen_llm::providers::gemini::{
    GeminiGenerateContentCurlRequest, GeminiGenerateContentHttpRequestParams,
    gemini_generate_content_curl, gemini_generate_content_http_request,
};
use octofwen_llm::providers::openai::{
    OpenAiChatCompletionsCurlRequest, OpenAiChatCompletionsHttpRequestParams,
    OpenAiResponsesCurlRequest, OpenAiResponsesHttpRequestParams, openai_chat_completions_curl,
    openai_chat_completions_http_request, openai_responses_curl, openai_responses_http_request,
};
use octofwen_llm::providers::tool_definitions::{
    ProviderToolDefinition, ProviderToolDefinitionTarget, provider_tool_definitions_json,
};
use octofwen_llm::providers::{
    ProviderHttpRequest, anthropic_messages_from_ts_ir, gemini_contents_from_ts_ir,
    openai_chat_completions_messages_from_ts_ir, openai_responses_input_from_ts_ir,
};
use octofwen_protocol::json_rpc::{
    JSON_RPC_VERSION, JsonRpcId, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, Write};

mod autofix;
mod compaction_decision;
mod config;
mod conversation_history;
mod input_history;
mod model;
mod octo_lower;
mod provider;
mod skill_discovery;
mod synthetic_quota;
mod system_prompt;
mod tool;
mod trajectory;
mod transport;
mod update_notifications;
use autofix::{autofix_edit_response, autofix_json_response};
use compaction_decision::{
    compaction_checkpoint_content_response, compaction_decision_response,
    compaction_prepare_response,
};
use config::{
    config_autofix_keys_response, config_default_paths_response, config_has_existing_key_response,
    config_key_for_base_url_response, config_key_for_model_response,
    config_merge_autofix_env_var_response, config_merge_env_var_response, config_migrate_response,
    config_run_notify_response, config_sanitize_response, config_search_response,
    config_select_model_response, config_write_key_response,
};
use conversation_history::{
    conversation_history_append_response, conversation_history_llm_payloads_response,
    conversation_history_records_response,
};
use input_history::{input_history_append_response, input_history_load_response};
use model::model_connection_test_response;
use model::{
    model_provider_catalog_response, model_provider_for_base_url_response,
    model_provider_key_from_name_response, model_recommended_model_response,
};
use octo_lower::octo_lower_response;
use provider::ProviderHttpStreamRequest;
use provider::provider_compiler_complete_response;
use skill_discovery::skill_discover_response;
use synthetic_quota::synthetic_quota_fetch_response;
use system_prompt::system_prompt_response;
use tool::tool_definitions_response;
use tool::tool_permission_response;
use tool::tool_run_response;
use tool::tool_validate_response;
use trajectory::trajectory_arc_response;
use trajectory::trajectory_finish_response;
use transport::{
    transport_docker_kill_response, transport_docker_response, transport_docker_run_response,
    transport_find_files_response, transport_get_env_response, transport_local_response,
    transport_ssh_response,
};
use update_notifications::{
    update_notifications_mark_seen_response, update_notifications_read_response,
};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCompilerPlanParams {
    #[serde(rename = "type")]
    provider_type: Option<ProviderCompilerPlanTypeParam>,
    #[serde(rename = "baseUrl")]
    base_url: String,
    model: String,
    context: u64,
    reasoning: Option<ProviderReasoningParam>,
    #[serde(rename = "thinkingBudgetTokens")]
    thinking_budget_tokens: Option<u64>,
    modalities: Option<ProviderCompilerModalitiesParam>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ProviderCompilerPlanTypeParam {
    Standard,
    OpenaiResponses,
    Anthropic,
    Gemini,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ProviderReasoningParam {
    None,
    Minimal,
    Low,
    Medium,
    High,
    #[serde(rename = "xhigh")]
    XHigh,
}

#[derive(Debug, Deserialize)]
struct ProviderCompilerModalitiesParam {
    image: Option<ProviderCompilerImageModalityParam>,
}

#[derive(Debug, Deserialize)]
struct ProviderCompilerImageModalityParam {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderHttpRequestParams {
    plan: ProviderHttpRequestPlanParam,
    #[serde(rename = "apiKey")]
    api_key: String,
    irs: Vec<Value>,
    system: Option<String>,
    tools: Option<Vec<ProviderToolDefinition>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCompilerRequestParams {
    #[serde(rename = "type")]
    provider_type: Option<ProviderCompilerPlanTypeParam>,
    #[serde(rename = "baseUrl")]
    base_url: String,
    model: String,
    context: u64,
    reasoning: Option<ProviderReasoningParam>,
    #[serde(rename = "thinkingBudgetTokens")]
    thinking_budget_tokens: Option<u64>,
    modalities: Option<ProviderCompilerModalitiesParam>,
    #[serde(rename = "apiKey")]
    api_key: String,
    irs: Vec<Value>,
    system: Option<String>,
    tools: Option<Vec<ProviderToolDefinition>>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "provider", rename_all = "kebab-case")]
enum ProviderHttpRequestPlanParam {
    OpenaiChatCompletions {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
    },
    OpenaiResponses {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
        reasoning: Option<Value>,
    },
    Anthropic {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
        #[serde(rename = "maxTokens")]
        max_tokens: u64,
        thinking: Option<Value>,
        #[serde(rename = "outputConfig")]
        output_config: Option<Value>,
    },
    Gemini {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
    },
}

pub fn handle_agentd_json_rpc_line(line: &str) -> Option<String> {
    let request = match serde_json::from_str::<AgentdRequest>(line) {
        Ok(request) => request,
        Err(_) => {
            return Some(serialize_response(create_json_rpc_error(
                JsonRpcId::Null,
                PARSE_ERROR,
                "Parse error",
                None,
            )));
        }
    };

    let Some(id) = request.id else {
        return None;
    };

    if request.jsonrpc != JSON_RPC_VERSION {
        return Some(serialize_response(create_json_rpc_error(
            id,
            INVALID_REQUEST,
            "Invalid Request",
            None,
        )));
    }

    let response = match request.method.as_str() {
        AGENTD_INITIALIZE_METHOD => create_json_rpc_success(id, initialize_result()),
        AGENTD_INPUT_HISTORY_LOAD_METHOD => input_history_load_response(id, request.params),
        AGENTD_INPUT_HISTORY_APPEND_METHOD => input_history_append_response(id, request.params),
        AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD => {
            update_notifications_read_response(id, request.params)
        }
        AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD => {
            update_notifications_mark_seen_response(id, request.params)
        }
        AGENTD_CONVERSATION_HISTORY_APPEND_METHOD => {
            conversation_history_append_response(id, request.params)
        }
        AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD => {
            conversation_history_records_response(id, request.params)
        }
        AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD => {
            conversation_history_llm_payloads_response(id, request.params)
        }
        AGENTD_TRAJECTORY_ARC_METHOD => trajectory_arc_response(id, request.params),
        AGENTD_TRAJECTORY_FINISH_METHOD => trajectory_finish_response(id, request.params),
        AGENTD_SYSTEM_PROMPT_METHOD => system_prompt_response(id, request.params),
        AGENTD_COMPACTION_DECISION_METHOD => compaction_decision_response(id, request.params),
        AGENTD_COMPACTION_PREPARE_METHOD => compaction_prepare_response(id, request.params),
        AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD => {
            compaction_checkpoint_content_response(id, request.params)
        }
        AGENTD_CONFIG_MIGRATE_METHOD => config_migrate_response(id, request.params),
        AGENTD_CONFIG_SANITIZE_METHOD => config_sanitize_response(id, request.params),
        AGENTD_CONFIG_KEY_FOR_MODEL_METHOD => config_key_for_model_response(id, request.params),
        AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD => {
            config_key_for_base_url_response(id, request.params)
        }
        AGENTD_CONFIG_SEARCH_METHOD => config_search_response(id, request.params),
        AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD => {
            config_has_existing_key_response(id, request.params)
        }
        AGENTD_CONFIG_WRITE_KEY_METHOD => config_write_key_response(id, request.params),
        AGENTD_CONFIG_MERGE_ENV_VAR_METHOD => config_merge_env_var_response(id, request.params),
        AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD => {
            config_merge_autofix_env_var_response(id, request.params)
        }
        AGENTD_CONFIG_AUTOFIX_KEYS_METHOD => config_autofix_keys_response(id),
        AGENTD_CONFIG_DEFAULT_PATHS_METHOD => config_default_paths_response(id),
        AGENTD_CONFIG_RUN_NOTIFY_METHOD => config_run_notify_response(id, request.params),
        AGENTD_CONFIG_SELECT_MODEL_METHOD => config_select_model_response(id, request.params),
        AGENTD_AUTOFIX_JSON_METHOD => autofix_json_response(id, request.params),
        AGENTD_AUTOFIX_EDIT_METHOD => autofix_edit_response(id, request.params),
        AGENTD_OCTO_LOWER_METHOD => octo_lower_response(id, request.params),
        AGENTD_RENDER_TOOL_CALL_METHOD => render_tool_call_response(id, request.params),
        AGENTD_TOOL_DEFINITIONS_METHOD => tool_definitions_response(id, request.params),
        AGENTD_TOOL_RUN_METHOD => tool_run_response(id, request.params),
        AGENTD_TOOL_PERMISSION_METHOD => tool_permission_response(id, request.params),
        AGENTD_TOOL_VALIDATE_METHOD => tool_validate_response(id, request.params),
        AGENTD_TRANSPORT_LOCAL_METHOD => transport_local_response(id, request.params),
        AGENTD_TRANSPORT_DOCKER_METHOD => transport_docker_response(id, request.params),
        AGENTD_TRANSPORT_SSH_METHOD => transport_ssh_response(id, request.params),
        AGENTD_TRANSPORT_FIND_FILES_METHOD => transport_find_files_response(id, request.params),
        AGENTD_TRANSPORT_GET_ENV_METHOD => transport_get_env_response(id, request.params),
        AGENTD_TRANSPORT_DOCKER_RUN_METHOD => transport_docker_run_response(id, request.params),
        AGENTD_TRANSPORT_DOCKER_KILL_METHOD => transport_docker_kill_response(id, request.params),
        AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD => {
            provider_compiler_complete_response(id, request.params)
        }
        AGENTD_MODEL_PROVIDER_CATALOG_METHOD => model_provider_catalog_response(id),
        AGENTD_MODEL_PROVIDER_KEY_FROM_NAME_METHOD => {
            model_provider_key_from_name_response(id, request.params)
        }
        AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD => {
            model_provider_for_base_url_response(id, request.params)
        }
        AGENTD_MODEL_RECOMMENDED_MODEL_METHOD => {
            model_recommended_model_response(id, request.params)
        }
        AGENTD_MODEL_CONNECTION_TEST_METHOD => model_connection_test_response(id, request.params),
        AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD => synthetic_quota_fetch_response(id, request.params),
        AGENTD_SKILL_DISCOVER_METHOD => skill_discover_response(id, request.params),
        _ => create_json_rpc_error(id, METHOD_NOT_FOUND, "Method not found", None),
    };

    Some(serialize_response(response))
}

fn provider_compiler_plan_json(
    params: ProviderCompilerPlanParams,
) -> serde_json::Map<String, Value> {
    let mut modalities = vec![Value::String("text".into())];
    if params
        .modalities
        .as_ref()
        .and_then(|modalities| modalities.image.as_ref())
        .is_some_and(|image| image.enabled)
    {
        modalities.push(Value::String("vision".into()));
    }

    let provider_type = params
        .provider_type
        .unwrap_or(ProviderCompilerPlanTypeParam::Standard);
    let mut result = serde_json::Map::from_iter([
        ("baseUrl".into(), Value::String(params.base_url)),
        ("model".into(), Value::String(params.model.clone())),
        ("modalities".into(), Value::Array(modalities)),
    ]);

    match provider_type {
        ProviderCompilerPlanTypeParam::Standard => {
            result.insert(
                "provider".into(),
                Value::String("openai-chat-completions".into()),
            );
        }
        ProviderCompilerPlanTypeParam::OpenaiResponses => {
            result.insert("provider".into(), Value::String("openai-responses".into()));
            if let Some(reasoning) = openai_responses_reasoning(params.reasoning) {
                result.insert("reasoning".into(), reasoning);
            }
        }
        ProviderCompilerPlanTypeParam::Anthropic => {
            result.insert("provider".into(), Value::String("anthropic".into()));
            let max_tokens = params.context.min(32_000);
            result.insert("maxTokens".into(), Value::from(max_tokens));
            let thinking = anthropic_thinking(
                &params.model,
                params.reasoning,
                params.thinking_budget_tokens,
                max_tokens,
            );
            if let Some(thinking) = thinking {
                result.insert("thinking".into(), thinking);
            }
            if let Some(output_config) = anthropic_output_config(&params.model, params.reasoning) {
                result.insert("outputConfig".into(), output_config);
            }
        }
        ProviderCompilerPlanTypeParam::Gemini => {
            result.insert("provider".into(), Value::String("gemini".into()));
        }
    }

    result
}

fn openai_responses_reasoning(reasoning: Option<ProviderReasoningParam>) -> Option<Value> {
    reasoning.map(|effort| {
        json!({
            "effort": provider_reasoning_effort(effort),
            "summary": "auto",
        })
    })
}

fn anthropic_thinking(
    model: &str,
    reasoning: Option<ProviderReasoningParam>,
    explicit_budget_tokens: Option<u64>,
    max_tokens: u64,
) -> Option<Value> {
    if anthropic_uses_adaptive_thinking(model) {
        return anthropic_adaptive_thinking(model, reasoning, explicit_budget_tokens);
    }

    explicit_budget_tokens
        .or_else(|| anthropic_thinking_budget(reasoning))
        .and_then(|budget_tokens| anthropic_valid_thinking_budget(budget_tokens, max_tokens))
        .map(|budget_tokens| {
            json!({
                "type": "enabled",
                "budget_tokens": budget_tokens,
            })
        })
}

fn anthropic_adaptive_thinking(
    model: &str,
    reasoning: Option<ProviderReasoningParam>,
    explicit_budget_tokens: Option<u64>,
) -> Option<Value> {
    match reasoning {
        Some(ProviderReasoningParam::None) if anthropic_can_disable_adaptive_thinking(model) => {
            Some(json!({ "type": "disabled" }))
        }
        Some(ProviderReasoningParam::None) | None
            if anthropic_adaptive_thinking_is_always_on(model) =>
        {
            None
        }
        Some(ProviderReasoningParam::None) => None,
        None if explicit_budget_tokens.is_some() => Some(json!({ "type": "adaptive" })),
        None => None,
        Some(_) if anthropic_adaptive_thinking_is_always_on(model) => None,
        Some(_) => Some(json!({ "type": "adaptive" })),
    }
}

fn anthropic_output_config(
    model: &str,
    reasoning: Option<ProviderReasoningParam>,
) -> Option<Value> {
    if !anthropic_supports_effort(model) {
        return None;
    }
    let reasoning = reasoning?;
    let effort = anthropic_effort(reasoning)?;
    Some(json!({ "effort": effort }))
}

fn anthropic_effort(reasoning: ProviderReasoningParam) -> Option<&'static str> {
    match reasoning {
        ProviderReasoningParam::XHigh => Some("xhigh"),
        ProviderReasoningParam::High => Some("high"),
        ProviderReasoningParam::Medium => Some("medium"),
        ProviderReasoningParam::Low | ProviderReasoningParam::Minimal => Some("low"),
        ProviderReasoningParam::None => None,
    }
}

fn anthropic_uses_adaptive_thinking(model: &str) -> bool {
    anthropic_model_family(
        model,
        &[
            "claude-fable-5",
            "claude-mythos-5",
            "claude-opus-4-8",
            "claude-opus-4-7",
            "claude-sonnet-5",
        ],
    )
}

fn anthropic_adaptive_thinking_is_always_on(model: &str) -> bool {
    anthropic_model_family(model, &["claude-fable-5", "claude-mythos-5"])
}

fn anthropic_can_disable_adaptive_thinking(model: &str) -> bool {
    anthropic_model_family(model, &["claude-sonnet-5"])
}

fn anthropic_supports_effort(model: &str) -> bool {
    anthropic_model_family(
        model,
        &[
            "claude-fable-5",
            "claude-mythos-5",
            "claude-opus-4-8",
            "claude-opus-4-7",
            "claude-opus-4-6",
            "claude-sonnet-5",
            "claude-sonnet-4-6",
            "claude-opus-4-5",
        ],
    )
}

fn anthropic_model_family(model: &str, families: &[&str]) -> bool {
    families.iter().any(|family| {
        model == *family
            || model
                .strip_prefix(family)
                .is_some_and(|suffix| suffix.starts_with('-'))
    })
}

fn anthropic_valid_thinking_budget(budget_tokens: u64, max_tokens: u64) -> Option<u64> {
    if !(1024..max_tokens).contains(&budget_tokens) {
        return None;
    }
    Some(budget_tokens)
}

fn anthropic_thinking_budget(reasoning: Option<ProviderReasoningParam>) -> Option<u64> {
    Some(match reasoning? {
        ProviderReasoningParam::XHigh => 16_384,
        ProviderReasoningParam::High => 8192,
        ProviderReasoningParam::Medium => 4096,
        ProviderReasoningParam::Low => 2048,
        ProviderReasoningParam::Minimal => 1024,
        ProviderReasoningParam::None => return None,
    })
}

fn provider_reasoning_effort(reasoning: ProviderReasoningParam) -> &'static str {
    match reasoning {
        ProviderReasoningParam::XHigh => "xhigh",
        ProviderReasoningParam::High => "high",
        ProviderReasoningParam::Medium => "medium",
        ProviderReasoningParam::Low => "low",
        ProviderReasoningParam::Minimal => "minimal",
        ProviderReasoningParam::None => "none",
    }
}

pub fn run_agentd_jsonl(
    reader: impl BufRead,
    mut writer: impl Write,
) -> Result<(), std::io::Error> {
    for line in reader.lines() {
        let line = line?;
        if let Some(response) = handle_agentd_json_rpc_line(&line) {
            writeln!(writer, "{response}")?;
            writer.flush()?;
        }
    }
    Ok(())
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

fn render_tool_call_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofwen_protocol::json_rpc::JsonRpcResponse {
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

fn provider_http_request_parts(
    params: ProviderHttpRequestParams,
) -> Result<
    (
        &'static str,
        AssistantOutputProvider,
        ProviderHttpRequest,
        String,
    ),
    (),
> {
    let ProviderHttpRequestParams {
        plan,
        api_key,
        irs,
        system,
        tools,
    } = params;

    let result = match plan {
        ProviderHttpRequestPlanParam::OpenaiChatCompletions {
            base_url,
            model,
            modalities,
        } => {
            let Ok(messages) = openai_chat_completions_messages_from_ts_ir(
                &irs,
                system.as_deref(),
                modalities.as_deref(),
            ) else {
                return Err(());
            };
            let tools = provider_tool_definitions_json(
                ProviderToolDefinitionTarget::OpenAiChatCompletions,
                tools,
            );
            let curl_request = OpenAiChatCompletionsCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                messages: messages.clone(),
                tools: tools.clone(),
            };
            let http_request = OpenAiChatCompletionsHttpRequestParams {
                base_url,
                api_key,
                model,
                messages,
                tools,
            };
            (
                "openai-chat-completions",
                AssistantOutputProvider::OpenAiChatCompletions,
                openai_chat_completions_http_request(&http_request),
                openai_chat_completions_curl(&curl_request),
            )
        }
        ProviderHttpRequestPlanParam::OpenaiResponses {
            base_url,
            model,
            modalities,
            reasoning,
        } => {
            let Ok(input) = openai_responses_input_from_ts_ir(&irs, modalities.as_deref()) else {
                return Err(());
            };
            let tools = provider_tool_definitions_json(
                ProviderToolDefinitionTarget::OpenAiResponses,
                tools,
            );
            let curl_request = OpenAiResponsesCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                input: input.clone(),
                instructions: system.clone(),
                tools: tools.clone(),
                reasoning: reasoning.clone(),
            };
            let http_request = OpenAiResponsesHttpRequestParams {
                base_url,
                api_key,
                model,
                input,
                instructions: system,
                tools,
                reasoning,
            };
            (
                "openai-responses",
                AssistantOutputProvider::OpenAiResponses,
                openai_responses_http_request(&http_request),
                openai_responses_curl(&curl_request),
            )
        }
        ProviderHttpRequestPlanParam::Anthropic {
            base_url,
            model,
            modalities,
            max_tokens,
            thinking,
            output_config,
        } => {
            let Ok(messages) = anthropic_messages_from_ts_ir(&irs, modalities.as_deref()) else {
                return Err(());
            };
            let tools =
                provider_tool_definitions_json(ProviderToolDefinitionTarget::Anthropic, tools);
            let curl_request = AnthropicCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                system: system.clone().unwrap_or_default(),
                messages: messages.clone(),
                tools: tools.clone(),
                max_tokens,
                thinking: thinking.clone(),
                output_config: output_config.clone(),
            };
            let http_request = AnthropicMessagesHttpRequestParams {
                base_url,
                api_key,
                model,
                system: system.unwrap_or_default(),
                messages,
                tools,
                max_tokens,
                thinking,
                output_config,
            };
            (
                "anthropic",
                AssistantOutputProvider::Anthropic,
                anthropic_messages_http_request(&http_request),
                anthropic_messages_curl(&curl_request),
            )
        }
        ProviderHttpRequestPlanParam::Gemini {
            base_url,
            model,
            modalities,
        } => {
            let Ok(contents) = gemini_contents_from_ts_ir(&irs, modalities.as_deref()) else {
                return Err(());
            };
            let system_instruction = system.map(|system| {
                json!({
                    "parts": [{ "text": system }],
                })
            });
            let tools = provider_tool_definitions_json(ProviderToolDefinitionTarget::Gemini, tools);
            let curl_request = GeminiGenerateContentCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                contents: contents.clone(),
                system_instruction: system_instruction.clone(),
                tools: tools.clone(),
            };
            let http_request = GeminiGenerateContentHttpRequestParams {
                base_url,
                api_key,
                model,
                contents,
                system_instruction,
                tools,
            };
            (
                "gemini",
                AssistantOutputProvider::Gemini,
                gemini_generate_content_http_request(&http_request),
                gemini_generate_content_curl(&curl_request),
            )
        }
    };

    Ok(result)
}

fn provider_http_stream_request(request: &ProviderHttpRequest) -> ProviderHttpStreamRequest {
    ProviderHttpStreamRequest {
        method: request.method.clone(),
        url: request.url.clone(),
        headers: request
            .headers
            .iter()
            .map(|(name, value)| (name.clone(), Value::String(value.clone())))
            .collect(),
        body: request.body.clone(),
    }
}

fn serialize_response(response: octofwen_protocol::json_rpc::JsonRpcResponse) -> String {
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
