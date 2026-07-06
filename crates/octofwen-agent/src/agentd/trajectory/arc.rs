use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::super::tool::{tool_definitions_response, tool_validate_response};
use super::super::{
    INVALID_PARAMS, compaction_checkpoint_content_response, compaction_decision_response,
    compaction_prepare_response, octo_lower_response, provider_compiler_complete_response,
    skill_discover_response, system_prompt_response,
};
use super::trajectory_finish_response;

const FORGOTTEN_CHECK_PROMPT: &str = "Before returning control to the user, check whether the previous assistant response forgot any required finalization. In particular, verify whether you should run relevant tests, run a compiler, run a typecheck or lint, inspect an expected result, or report a precise blocker. If the previous response is already complete, answer with the same final response. If anything actionable is missing, use the available tools to do that work instead of returning to the user.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryArcParams {
    cwd: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    model: TrajectoryArcModelParam,
    messages: Vec<Value>,
    config: TrajectoryArcConfigParam,
    aborted: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryArcModelParam {
    #[serde(rename = "type")]
    provider_type: Option<String>,
    #[serde(rename = "baseUrl")]
    base_url: String,
    model: String,
    context: u64,
    reasoning: Option<String>,
    #[serde(rename = "thinkingBudgetTokens")]
    thinking_budget_tokens: Option<u64>,
    modalities: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryArcConfigParam {
    #[serde(rename = "yourName")]
    your_name: String,
    #[serde(default)]
    mcp_servers: Option<Value>,
    #[serde(default)]
    search: Option<Value>,
    #[serde(default)]
    has_web_search: Option<bool>,
    #[serde(default)]
    skills: Option<TrajectoryArcSkillsConfigParam>,
    #[serde(default)]
    default_api_key_overrides: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    auth_models: Vec<TrajectoryArcAuthModelParam>,
    #[serde(default)]
    fix_json: Option<TrajectoryArcAuxModelParam>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryArcSkillsConfigParam {
    #[serde(default)]
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryArcAuthModelParam {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiEnvVar")]
    api_env_var: Option<String>,
    auth: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryArcAuxModelParam {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    #[serde(rename = "apiEnvVar")]
    api_env_var: Option<String>,
    auth: Option<Value>,
    model: String,
}

pub(in crate::agentd) fn trajectory_arc_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<TrajectoryArcParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    match trajectory_arc_result_json(params) {
        Ok(result) => create_json_rpc_success(id, result),
        Err(response) => response.with_id(id),
    }
}

trait ResponseIdExt {
    fn with_id(self, id: JsonRpcId) -> JsonRpcResponse;
}

impl ResponseIdExt for JsonRpcResponse {
    fn with_id(self, id: JsonRpcId) -> JsonRpcResponse {
        match self {
            JsonRpcResponse::Success { result, .. } => create_json_rpc_success(id, result),
            JsonRpcResponse::Error { error, .. } => JsonRpcResponse::Error {
                jsonrpc: octofwen_protocol::json_rpc::JSON_RPC_VERSION,
                id,
                error,
            },
        }
    }
}

fn trajectory_arc_result_json(params: TrajectoryArcParams) -> Result<Value, JsonRpcResponse> {
    if params.aborted.unwrap_or(false) {
        return Ok(json!({
            "type": "finish",
            "irs": [],
            "reason": { "type": "abort" },
            "events": [],
        }));
    }

    let skills = call_result(skill_discover_response(
        JsonRpcId::String("trajectory-arc-skill-discover".into()),
        Some(json!({
            "cwd": params.cwd,
            "home": std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_default(),
            "configuredSkillPaths": params.config.skills.as_ref().map(|skills| skills.paths.clone()).unwrap_or_default(),
        })),
    ))?;
    let tool_definitions = call_result(tool_definitions_response(
        JsonRpcId::String("trajectory-arc-tool-definitions".into()),
        Some(json!({
            "hasMcpServers": has_mcp_servers(params.config.mcp_servers.as_ref()),
            "hasWebSearch": params.config.has_web_search.unwrap_or_else(|| has_web_search(params.config.search.as_ref())),
            "skills": skills.get("skills").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        })),
    ))?;
    let system_prompt = call_result(system_prompt_response(
        JsonRpcId::String("trajectory-arc-system-prompt".into()),
        Some(json!({
            "userName": params.config.your_name,
            "workingDirectory": params.cwd,
            "mcpPrompt": "",
        })),
    ))?;
    let mut events = Vec::new();
    let provider_irs = provider_irs_after_compaction(&params, &mut events)?;
    let system_prompt_text = system_prompt.get("prompt").cloned().unwrap_or(Value::Null);
    let tools = provider_tools(tool_definitions.get("tools"));

    let provider_result = call_main_provider(
        &params,
        provider_irs.clone(),
        system_prompt_text.clone(),
        tools.clone(),
        "trajectory-arc-provider",
    )?;

    events.extend(provider_response_events(provider_result.get("events")));
    let quota_finish = call_result(trajectory_finish_response(
        JsonRpcId::String("trajectory-arc-quota".into()),
        Some(json!({
            "irs": [],
            "headers": provider_result.get("headers").cloned().unwrap_or_else(|| Value::Object(Map::new())),
        })),
    ))?;
    events.extend(value_array(quota_finish.get("events")));

    let finish = if provider_result.get("status").and_then(Value::as_str) == Some("error") {
        call_result(trajectory_finish_response(
            JsonRpcId::String("trajectory-arc-provider-error".into()),
            Some(json!({
                "irs": [],
                "compilerError": provider_result.get("error").cloned().unwrap_or(Value::Null),
            })),
        ))?
    } else {
        let assistant_finish = call_result(trajectory_finish_response(
            JsonRpcId::String("trajectory-arc-finish".into()),
            Some(json!({
                "irs": checkpoint_irs(&provider_irs),
                "assistantMessage": provider_result.get("output").cloned().unwrap_or(Value::Null),
            })),
        ))?;
        let finish = finish_after_tool_validation(assistant_finish, &params.cwd)?;
        finish_after_forgotten_check(finish, &params, system_prompt_text, tools, &mut events)?
    };

    events.extend(value_array(finish.get("events")));
    Ok(json!({
        "type": "finish",
        "irs": finish.get("irs").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "reason": finish.get("reason").cloned().unwrap_or_else(|| json!({ "type": "needs-response" })),
        "events": events,
    }))
}

fn call_main_provider(
    params: &TrajectoryArcParams,
    irs: Value,
    system: Value,
    tools: Value,
    id: &str,
) -> Result<Value, JsonRpcResponse> {
    call_result(provider_compiler_complete_response(
        JsonRpcId::String(id.into()),
        Some(json!({
            "type": params.model.provider_type.clone(),
            "baseUrl": params.model.base_url.clone(),
            "model": params.model.model.clone(),
            "context": params.model.context,
            "reasoning": params.model.reasoning.clone(),
            "thinkingBudgetTokens": params.model.thinking_budget_tokens,
            "modalities": params.model.modalities.clone(),
            "apiKey": params.api_key.clone(),
            "irs": irs,
            "system": system,
            "tools": tools,
            "cwd": params.cwd.clone(),
            "aborted": false,
            "autofixJson": params.config.fix_json.as_ref().map(|config| json!({
                "baseUrl": config.base_url,
                "apiKey": config.api_key,
                "apiEnvVar": config.api_env_var,
                "auth": config.auth,
                "model": config.model,
                "defaultApiKeyOverrides": params.config.default_api_key_overrides,
                "authModels": params.config.auth_models.iter().map(|model| json!({
                    "baseUrl": model.base_url,
                    "apiEnvVar": model.api_env_var,
                    "auth": model.auth,
                })).collect::<Vec<_>>(),
            })),
        })),
    ))
}

fn provider_irs_after_compaction(
    params: &TrajectoryArcParams,
    events: &mut Vec<Value>,
) -> Result<Value, JsonRpcResponse> {
    let lowered = lower_messages(
        params.messages.clone(),
        params.model.modalities.as_ref().cloned(),
        "trajectory-arc-octo-lower",
    )?;
    let decision = call_result(compaction_decision_response(
        JsonRpcId::String("trajectory-arc-compaction-decision".into()),
        Some(json!({
            "maxContextWindow": params.model.context,
            "messages": params.messages,
        })),
    ))?;
    if decision.get("shouldCompact").and_then(Value::as_bool) != Some(true) {
        return Ok(lowered);
    }

    events.push(json!({ "type": "start-compaction" }));
    let prepared = call_result(compaction_prepare_response(
        JsonRpcId::String("trajectory-arc-compaction-prepare".into()),
        Some(json!({ "messages": params.messages })),
    ))?;
    let compaction_irs = lower_messages(
        prepared
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        params.model.modalities.as_ref().cloned(),
        "trajectory-arc-compaction-lower",
    )?;
    let compaction_result = call_result(provider_compiler_complete_response(
        JsonRpcId::String("trajectory-arc-compaction-provider".into()),
        Some(json!({
            "type": params.model.provider_type,
            "baseUrl": params.model.base_url,
            "model": params.model.model,
            "context": params.model.context,
            "reasoning": params.model.reasoning,
            "thinkingBudgetTokens": params.model.thinking_budget_tokens,
            "modalities": params.model.modalities,
            "apiKey": params.api_key,
            "irs": compaction_irs,
            "system": "",
            "tools": [],
            "cwd": params.cwd,
            "aborted": false,
        })),
    ))?;
    events.extend(provider_compaction_events(compaction_result.get("events")));

    if compaction_result.get("status").and_then(Value::as_str) == Some("error") {
        return Err(compaction_error_response(
            compaction_result.get("error"),
            events.clone(),
        ));
    }

    let checkpoint = call_result(compaction_checkpoint_content_response(
        JsonRpcId::String("trajectory-arc-compaction-checkpoint".into()),
        Some(json!({
            "output": compaction_result.get("output").cloned().unwrap_or(Value::Null),
        })),
    ))?;
    if checkpoint.get("status").and_then(Value::as_str) != Some("success") {
        return Ok(lowered);
    }

    let checkpoint_ir = json!({
        "role": "checkpoint",
        "content": checkpoint.get("content").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
    });
    events.push(json!({
        "type": "compaction-parsed",
        "checkpoint": checkpoint_ir,
    }));
    lower_messages(
        vec![checkpoint_ir],
        params.model.modalities.as_ref().cloned(),
        "trajectory-arc-post-compaction-lower",
    )
}

fn lower_messages(
    messages: Vec<Value>,
    modalities: Option<Value>,
    id: &str,
) -> Result<Value, JsonRpcResponse> {
    let lowered = call_result(octo_lower_response(
        JsonRpcId::String(id.into()),
        Some(json!({
            "messages": messages,
            "modalities": modalities,
        })),
    ))?;
    Ok(lowered
        .get("irs")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new())))
}

fn compaction_error_response(error: Option<&Value>, events: Vec<Value>) -> JsonRpcResponse {
    let error_type = error
        .and_then(|error| error.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("request-error");
    let request_error = error
        .and_then(|error| error.get("requestError"))
        .and_then(Value::as_str)
        .unwrap_or("Compaction request failed");
    let curl = error
        .and_then(|error| error.get("curl"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let reason = match error_type {
        "auth-error" | "payment-error" | "rate-limit-error" => json!({
            "type": error_type,
            "requestError": request_error,
            "curl": curl,
        }),
        _ => json!({
            "type": "compaction-error",
            "requestError": request_error,
            "curl": curl,
        }),
    };
    create_json_rpc_success(
        JsonRpcId::String("trajectory-arc-compaction-error".into()),
        json!({
            "type": "finish",
            "irs": [],
            "reason": reason,
            "events": events,
        }),
    )
}

fn checkpoint_irs(provider_irs: &Value) -> Value {
    let checkpoints = provider_irs
        .as_array()
        .map(|irs| {
            irs.iter()
                .filter(|ir| ir.get("role").and_then(Value::as_str) == Some("lowered-checkpoint"))
                .map(|ir| {
                    json!({
                        "role": "checkpoint",
                        "content": ir.get("content").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Value::Array(checkpoints)
}

fn call_result(response: JsonRpcResponse) -> Result<Value, JsonRpcResponse> {
    match response {
        JsonRpcResponse::Success { result, .. } => Ok(result),
        error @ JsonRpcResponse::Error { .. } => Err(error),
    }
}

fn has_mcp_servers(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Object(object)) => !object.is_empty(),
        Some(Value::Array(array)) => !array.is_empty(),
        Some(Value::Null) | None => false,
        Some(_) => true,
    }
}

fn has_web_search(value: Option<&Value>) -> bool {
    value.is_some_and(|search| !search.is_null())
}

fn provider_tools(value: Option<&Value>) -> Value {
    let tools = value.and_then(Value::as_array).cloned().unwrap_or_default();
    Value::Array(
        tools
            .into_iter()
            .map(|tool| {
                json!({
                    "name": tool.get("name").cloned().unwrap_or(Value::Null),
                    "description": tool.get("description").cloned().unwrap_or(Value::Null),
                    "schema": tool.get("argumentsSchema").cloned().unwrap_or(Value::Null),
                })
            })
            .collect(),
    )
}

fn provider_response_events(value: Option<&Value>) -> Vec<Value> {
    provider_stream_events(value, "start-response", "response-progress")
}

fn provider_compaction_events(value: Option<&Value>) -> Vec<Value> {
    provider_stream_events(value, "", "compaction-progress")
}

fn provider_stream_events(
    value: Option<&Value>,
    start_type: &str,
    progress_type: &str,
) -> Vec<Value> {
    let mut events = vec![json!({ "type": "start-response" })];
    if start_type.is_empty() {
        events.clear();
    } else {
        events[0] = json!({ "type": start_type });
    }
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut tool = String::new();
    for event in value_array(value) {
        if event.get("type").and_then(Value::as_str) == Some("autofixing-json") {
            events.push(json!({ "type": "autofixing-json" }));
            continue;
        }
        if event.get("type").and_then(Value::as_str) == Some("usage") {
            events.push(json!({
                "type": "token-usage",
                "input": event.get("input").cloned().unwrap_or(Value::from(0)),
                "output": event.get("output").cloned().unwrap_or(Value::from(0)),
            }));
            continue;
        }
        if event.get("type").and_then(Value::as_str) != Some("token") {
            continue;
        }
        let Some(delta) = event.get("text").and_then(Value::as_str) else {
            continue;
        };
        let kind = event
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("content");
        match kind {
            "reasoning" => reasoning.push_str(delta),
            "tool" => tool.push_str(delta),
            _ => content.push_str(delta),
        }
        let buffer = if progress_type == "compaction-progress" {
            json!({
                "content": if content.is_empty() { Value::Null } else { Value::String(content.clone()) },
                "reasoning": if reasoning.is_empty() { Value::Null } else { Value::String(reasoning.clone()) },
            })
        } else {
            json!({
                "content": if content.is_empty() { Value::Null } else { Value::String(content.clone()) },
                "reasoning": if reasoning.is_empty() { Value::Null } else { Value::String(reasoning.clone()) },
                "tool": if tool.is_empty() { Value::Null } else { Value::String(tool.clone()) },
            })
        };
        events.push(json!({
            "type": progress_type,
            "buffer": buffer,
            "delta": { "type": kind, "value": delta },
        }));
    }
    events
}

fn finish_after_tool_validation(finish: Value, cwd: &str) -> Result<Value, JsonRpcResponse> {
    if finish
        .get("reason")
        .and_then(|reason| reason.get("type"))
        .and_then(Value::as_str)
        != Some("request-tool")
    {
        return Ok(finish);
    }

    let tool_calls = finish
        .get("reason")
        .and_then(|reason| reason.get("toolCalls"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let validation_results = tool_calls
        .iter()
        .map(|tool_call| validate_tool_call(cwd, tool_call))
        .collect::<Vec<_>>();

    call_result(trajectory_finish_response(
        JsonRpcId::String("trajectory-arc-validation".into()),
        Some(json!({
            "irs": finish.get("irs").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
            "toolCalls": tool_calls,
            "validationResults": validation_results,
        })),
    ))
}

fn finish_after_forgotten_check(
    finish: Value,
    params: &TrajectoryArcParams,
    system: Value,
    tools: Value,
    events: &mut Vec<Value>,
) -> Result<Value, JsonRpcResponse> {
    if !should_run_forgotten_check(&finish) {
        return Ok(finish);
    }

    let original_irs = finish
        .get("irs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let (base_irs, provider_irs) = forgotten_check_irs(original_irs);
    let provider_result = match call_main_provider(
        params,
        Value::Array(provider_irs),
        system,
        tools,
        "trajectory-arc-forgotten-check-provider",
    ) {
        Ok(result) => result,
        Err(_) => return Ok(finish),
    };
    if provider_result.get("status").and_then(Value::as_str) == Some("error") {
        return Ok(finish);
    }

    events.extend(provider_response_events(provider_result.get("events")));
    let checked_finish = call_result(trajectory_finish_response(
        JsonRpcId::String("trajectory-arc-forgotten-check-finish".into()),
        Some(json!({
            "irs": base_irs,
            "assistantMessage": provider_result.get("output").cloned().unwrap_or(Value::Null),
        })),
    ))?;
    finish_after_tool_validation(checked_finish, &params.cwd)
}

fn should_run_forgotten_check(finish: &Value) -> bool {
    let reason = finish
        .get("reason")
        .and_then(|reason| reason.get("type"))
        .and_then(Value::as_str);
    if reason != Some("needs-response") {
        return false;
    }
    let has_retry_tool_event = finish
        .get("events")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|event| event.get("type").and_then(Value::as_str) == Some("retry-tool"));
    if has_retry_tool_event {
        return false;
    }
    finish
        .get("irs")
        .and_then(Value::as_array)
        .and_then(|irs| irs.last())
        .and_then(|ir| ir.get("role"))
        .and_then(Value::as_str)
        == Some("assistant")
}

fn forgotten_check_irs(mut original_irs: Vec<Value>) -> (Vec<Value>, Vec<Value>) {
    let mut provider_irs = original_irs.clone();
    provider_irs.push(json!({
        "role": "user",
        "content": [{
            "type": "text",
            "content": FORGOTTEN_CHECK_PROMPT,
        }],
    }));
    if original_irs
        .last()
        .and_then(|ir| ir.get("role"))
        .and_then(Value::as_str)
        == Some("assistant")
    {
        original_irs.pop();
    }
    (original_irs, provider_irs)
}

fn validate_tool_call(cwd: &str, tool_call: &Value) -> Value {
    let response = tool_validate_response(
        JsonRpcId::String("trajectory-arc-tool-validate".into()),
        Some(json!({
            "toolName": tool_call.get("name").cloned().unwrap_or(Value::Null),
            "cwd": cwd,
            "parsed": tool_call.get("parsed").cloned().unwrap_or(Value::Null),
        })),
    );
    match call_result(response) {
        Ok(result) if result.get("status").and_then(Value::as_str) == Some("valid") => {
            json!({ "status": "valid" })
        }
        Ok(result) => json!({
            "status": "error",
            "message": result.get("message").and_then(Value::as_str).unwrap_or("Tool validation failed"),
            "aborted": false,
        }),
        Err(_) => json!({
            "status": "error",
            "message": "Tool validation failed",
            "aborted": false,
        }),
    }
}

fn value_array(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}
