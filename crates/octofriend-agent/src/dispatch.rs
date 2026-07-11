use octofriend_wire::json_rpc::{
    JSON_RPC_VERSION, JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde_json::Value;

use super::{
    A2A_GET_TASK_METHOD, A2A_SEND_MESSAGE_METHOD, ACP_INITIALIZE_METHOD, ACP_SESSION_NEW_METHOD,
    ACP_SESSION_PROMPT_METHOD, AGENTD_AUTOFIX_EDIT_METHOD, AGENTD_AUTOFIX_JSON_METHOD,
    AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD, AGENTD_COMPACTION_DECISION_METHOD,
    AGENTD_COMPACTION_PREPARE_METHOD, AGENTD_CONFIG_AUTOFIX_KEYS_METHOD,
    AGENTD_CONFIG_DEFAULT_PATHS_METHOD, AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD,
    AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD, AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
    AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD, AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
    AGENTD_CONFIG_MIGRATE_METHOD, AGENTD_CONFIG_RUN_NOTIFY_METHOD, AGENTD_CONFIG_SANITIZE_METHOD,
    AGENTD_CONFIG_SEARCH_METHOD, AGENTD_CONFIG_SELECT_MODEL_METHOD, AGENTD_CONFIG_WRITE_KEY_METHOD,
    AGENTD_CONVERSATION_HISTORY_APPEND_METHOD, AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
    AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD, AGENTD_INITIALIZE_METHOD,
    AGENTD_INPUT_HISTORY_APPEND_METHOD, AGENTD_INPUT_HISTORY_LOAD_METHOD,
    AGENTD_MODEL_CONNECTION_TEST_METHOD, AGENTD_MODEL_DISCOVER_METHOD,
    AGENTD_MODEL_PROVIDER_CATALOG_METHOD, AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD,
    AGENTD_MODEL_PROVIDER_KEY_FROM_NAME_METHOD, AGENTD_MODEL_RECOMMENDED_MODEL_METHOD,
    AGENTD_OCTO_LOWER_METHOD, AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
    AGENTD_RENDER_TOOL_CALL_METHOD, AGENTD_SKILL_DISCOVER_METHOD,
    AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD, AGENTD_SYSTEM_PROMPT_METHOD,
    AGENTD_TOOL_DEFINITIONS_METHOD, AGENTD_TOOL_PERMISSION_METHOD, AGENTD_TOOL_RUN_METHOD,
    AGENTD_TOOL_VALIDATE_METHOD, AGENTD_TRAJECTORY_ARC_METHOD, AGENTD_TRAJECTORY_FINISH_METHOD,
    AGENTD_TRANSPORT_DOCKER_KILL_METHOD, AGENTD_TRANSPORT_DOCKER_METHOD,
    AGENTD_TRANSPORT_DOCKER_RUN_METHOD, AGENTD_TRANSPORT_FIND_FILES_METHOD,
    AGENTD_TRANSPORT_GET_ENV_METHOD, AGENTD_TRANSPORT_LOCAL_METHOD, AGENTD_TRANSPORT_SSH_METHOD,
    AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD, AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
    AgentdJsonRpcHandlerState, AgentdRequest, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR,
    a2a_get_task_response, a2a_send_message_response, acp_initialize_response,
    acp_session_new_response, acp_session_prompt_response,
    autofix::autofix_edit_response,
    autofix::autofix_json_response,
    catalog::model_provider_catalog_response,
    catalog::model_provider_for_base_url_response,
    catalog::model_provider_key_from_name_response,
    catalog::model_recommended_model_response,
    catalog::{model_connection_test_response, model_discover_response},
    compaction::compaction_checkpoint_content_response,
    compaction::compaction_decision_response,
    compaction::compaction_prepare_response,
    config::config_autofix_keys_response,
    config::config_default_paths_response,
    config::config_has_existing_key_response,
    config::config_key_for_base_url_response,
    config::config_key_for_model_response,
    config::config_merge_autofix_env_var_response,
    config::config_merge_env_var_response,
    config::config_migrate_response,
    config::config_run_notify_response,
    config::config_sanitize_response,
    config::config_search_response,
    config::config_select_model_response,
    config::config_write_key_response,
    history::conversation_history_append_response,
    history::conversation_history_llm_payloads_response,
    history::conversation_history_records_response,
    initialize_result,
    input::input_history_append_response,
    input::input_history_load_response,
    octofriend::octo_lower_response,
    render_tool_call_response,
    run_log::trajectory_arc_response,
    run_log::trajectory_finish_response,
    serialize_response,
    skills::skill_discover_response,
    stream::provider_compiler_complete_response,
    synthetic_quota::synthetic_quota_fetch_response,
    system_prompt::system_prompt_response,
    tools::tool_definitions_response,
    tools::tool_permission_response,
    tools::tool_run_response,
    tools::tool_validate_response,
    transport::transport_docker_kill_response,
    transport::transport_docker_response,
    transport::transport_docker_run_response,
    transport::transport_find_files_response,
    transport::transport_get_env_response,
    transport::transport_local_response,
    transport::transport_ssh_response,
    updates::update_notifications_mark_seen_response,
    updates::update_notifications_read_response,
};

fn cloned_params(params: Option<&Value>) -> Option<Value> {
    params.cloned()
}

pub(super) fn handle_agentd_json_rpc_line_with_state(
    line: &str,
    state: AgentdJsonRpcHandlerState<'_>,
) -> Option<String> {
    let Ok(request) = serde_json::from_str::<AgentdRequest>(line) else {
        return Some(serialize_response(create_json_rpc_error(
            JsonRpcId::Null,
            PARSE_ERROR,
            "Parse error",
            None,
        )));
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

    let method = request.method.as_str();
    if let Some(response) =
        protocol_json_rpc_response(id.clone(), method, request.params.as_ref(), state)
    {
        return Some(serialize_response(response));
    }

    let response = agentd_json_rpc_response(id.clone(), method, request.params.as_ref())
        .unwrap_or_else(|| create_json_rpc_error(id, METHOD_NOT_FOUND, "Method not found", None));
    Some(serialize_response(response))
}

fn protocol_json_rpc_response(
    id: JsonRpcId,
    method: &str,
    params: Option<&Value>,
    state: AgentdJsonRpcHandlerState<'_>,
) -> Option<JsonRpcResponse> {
    match method {
        A2A_SEND_MESSAGE_METHOD => {
            Some(a2a_send_message_response(id, cloned_params(params), state))
        }
        A2A_GET_TASK_METHOD => Some(a2a_get_task_response(
            id,
            cloned_params(params),
            state.as_deref(),
        )),
        ACP_INITIALIZE_METHOD => Some(acp_initialize_response(id, cloned_params(params))),
        ACP_SESSION_NEW_METHOD => Some(acp_session_new_response(id, cloned_params(params), state)),
        ACP_SESSION_PROMPT_METHOD => Some(acp_session_prompt_response(
            id,
            cloned_params(params),
            state.as_deref(),
        )),
        _ => None,
    }
}

fn agentd_json_rpc_response(
    id: JsonRpcId,
    method: &str,
    params: Option<&Value>,
) -> Option<JsonRpcResponse> {
    agentd_storage_json_rpc_response(id.clone(), method, params)
        .or_else(|| agentd_config_json_rpc_response(id.clone(), method, params))
        .or_else(|| agentd_runtime_json_rpc_response(id.clone(), method, params))
        .or_else(|| agentd_model_json_rpc_response(id.clone(), method, params))
        .or_else(|| agentd_misc_json_rpc_response(id, method, params))
}

fn agentd_storage_json_rpc_response(
    id: JsonRpcId,
    method: &str,
    params: Option<&Value>,
) -> Option<JsonRpcResponse> {
    match method {
        AGENTD_INPUT_HISTORY_LOAD_METHOD => {
            Some(input_history_load_response(id, cloned_params(params)))
        }
        AGENTD_INPUT_HISTORY_APPEND_METHOD => {
            Some(input_history_append_response(id, cloned_params(params)))
        }
        AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD => Some(update_notifications_read_response(
            id,
            cloned_params(params),
        )),
        AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD => Some(
            update_notifications_mark_seen_response(id, cloned_params(params)),
        ),
        AGENTD_CONVERSATION_HISTORY_APPEND_METHOD => Some(conversation_history_append_response(
            id,
            cloned_params(params),
        )),
        AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD => Some(conversation_history_records_response(
            id,
            cloned_params(params),
        )),
        AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD => Some(
            conversation_history_llm_payloads_response(id, cloned_params(params)),
        ),
        _ => None,
    }
}

fn agentd_config_json_rpc_response(
    id: JsonRpcId,
    method: &str,
    params: Option<&Value>,
) -> Option<JsonRpcResponse> {
    match method {
        AGENTD_CONFIG_MIGRATE_METHOD => Some(config_migrate_response(id, cloned_params(params))),
        AGENTD_CONFIG_SANITIZE_METHOD => Some(config_sanitize_response(id, cloned_params(params))),
        AGENTD_CONFIG_KEY_FOR_MODEL_METHOD => {
            Some(config_key_for_model_response(id, cloned_params(params)))
        }
        AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD => {
            Some(config_key_for_base_url_response(id, cloned_params(params)))
        }
        AGENTD_CONFIG_SEARCH_METHOD => Some(config_search_response(id, cloned_params(params))),
        AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD => {
            Some(config_has_existing_key_response(id, cloned_params(params)))
        }
        AGENTD_CONFIG_WRITE_KEY_METHOD => {
            Some(config_write_key_response(id, cloned_params(params)))
        }
        AGENTD_CONFIG_MERGE_ENV_VAR_METHOD => {
            Some(config_merge_env_var_response(id, cloned_params(params)))
        }
        AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD => Some(config_merge_autofix_env_var_response(
            id,
            cloned_params(params),
        )),
        AGENTD_CONFIG_AUTOFIX_KEYS_METHOD => Some(config_autofix_keys_response(id)),
        AGENTD_CONFIG_DEFAULT_PATHS_METHOD => Some(config_default_paths_response(id)),
        AGENTD_CONFIG_RUN_NOTIFY_METHOD => {
            Some(config_run_notify_response(id, cloned_params(params)))
        }
        AGENTD_CONFIG_SELECT_MODEL_METHOD => {
            Some(config_select_model_response(id, cloned_params(params)))
        }
        _ => None,
    }
}

fn agentd_runtime_json_rpc_response(
    id: JsonRpcId,
    method: &str,
    params: Option<&Value>,
) -> Option<JsonRpcResponse> {
    match method {
        AGENTD_TRAJECTORY_ARC_METHOD => Some(trajectory_arc_response(id, cloned_params(params))),
        AGENTD_TRAJECTORY_FINISH_METHOD => {
            Some(trajectory_finish_response(id, cloned_params(params)))
        }
        AGENTD_TOOL_DEFINITIONS_METHOD => {
            Some(tool_definitions_response(id, cloned_params(params)))
        }
        AGENTD_TOOL_RUN_METHOD => Some(tool_run_response(id, cloned_params(params))),
        AGENTD_TOOL_PERMISSION_METHOD => Some(tool_permission_response(id, cloned_params(params))),
        AGENTD_TOOL_VALIDATE_METHOD => Some(tool_validate_response(id, cloned_params(params))),
        AGENTD_TRANSPORT_LOCAL_METHOD => Some(transport_local_response(id, cloned_params(params))),
        AGENTD_TRANSPORT_DOCKER_METHOD => {
            Some(transport_docker_response(id, cloned_params(params)))
        }
        AGENTD_TRANSPORT_SSH_METHOD => Some(transport_ssh_response(id, cloned_params(params))),
        AGENTD_TRANSPORT_FIND_FILES_METHOD => {
            Some(transport_find_files_response(id, cloned_params(params)))
        }
        AGENTD_TRANSPORT_GET_ENV_METHOD => {
            Some(transport_get_env_response(id, cloned_params(params)))
        }
        AGENTD_TRANSPORT_DOCKER_RUN_METHOD => {
            Some(transport_docker_run_response(id, cloned_params(params)))
        }
        AGENTD_TRANSPORT_DOCKER_KILL_METHOD => {
            Some(transport_docker_kill_response(id, cloned_params(params)))
        }
        _ => None,
    }
}

fn agentd_model_json_rpc_response(
    id: JsonRpcId,
    method: &str,
    params: Option<&Value>,
) -> Option<JsonRpcResponse> {
    match method {
        AGENTD_MODEL_PROVIDER_CATALOG_METHOD => Some(model_provider_catalog_response(id)),
        AGENTD_MODEL_PROVIDER_KEY_FROM_NAME_METHOD => Some(model_provider_key_from_name_response(
            id,
            cloned_params(params),
        )),
        AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD => Some(model_provider_for_base_url_response(
            id,
            cloned_params(params),
        )),
        AGENTD_MODEL_RECOMMENDED_MODEL_METHOD => {
            Some(model_recommended_model_response(id, cloned_params(params)))
        }
        AGENTD_MODEL_CONNECTION_TEST_METHOD => {
            Some(model_connection_test_response(id, cloned_params(params)))
        }
        AGENTD_MODEL_DISCOVER_METHOD => Some(model_discover_response(id, cloned_params(params))),
        AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD => Some(provider_compiler_complete_response(
            id,
            cloned_params(params),
        )),
        AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD => {
            Some(synthetic_quota_fetch_response(id, cloned_params(params)))
        }
        _ => None,
    }
}

fn agentd_misc_json_rpc_response(
    id: JsonRpcId,
    method: &str,
    params: Option<&Value>,
) -> Option<JsonRpcResponse> {
    match method {
        AGENTD_INITIALIZE_METHOD => Some(create_json_rpc_success(id, initialize_result())),
        AGENTD_SYSTEM_PROMPT_METHOD => Some(system_prompt_response(id, cloned_params(params))),
        AGENTD_COMPACTION_DECISION_METHOD => {
            Some(compaction_decision_response(id, cloned_params(params)))
        }
        AGENTD_COMPACTION_PREPARE_METHOD => {
            Some(compaction_prepare_response(id, cloned_params(params)))
        }
        AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD => Some(
            compaction_checkpoint_content_response(id, cloned_params(params)),
        ),
        AGENTD_AUTOFIX_JSON_METHOD => Some(autofix_json_response(id, cloned_params(params))),
        AGENTD_AUTOFIX_EDIT_METHOD => Some(autofix_edit_response(id, cloned_params(params))),
        AGENTD_OCTO_LOWER_METHOD => Some(octo_lower_response(id, cloned_params(params))),
        AGENTD_RENDER_TOOL_CALL_METHOD => {
            Some(render_tool_call_response(id, cloned_params(params)))
        }
        AGENTD_SKILL_DISCOVER_METHOD => Some(skill_discover_response(id, cloned_params(params))),
        _ => None,
    }
}
