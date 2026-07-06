use std::collections::BTreeMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde_json::{Map, Value, json};

use super::super::autofix::autofix_json_response;
use super::super::{
    INVALID_PARAMS, ProviderCompilerPlanParams, ProviderCompilerRequestParams,
    ProviderHttpRequestParams, ProviderHttpRequestPlanParam, provider_compiler_plan_json,
    provider_http_request_parts, provider_http_stream_request,
};
use super::http_stream::provider_http_events_result_json;
use super::provider_compiler_finalize_response;

pub(in crate::agentd) fn provider_compiler_complete_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(Value::Object(params)) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let Some(cwd) = params.get("cwd").cloned() else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let aborted = params
        .get("aborted")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let run_result = match provider_run_result(params.clone()) {
        Ok(result) => result,
        Err(response) => return response.with_id(id),
    };
    if run_result.get("status").and_then(Value::as_str) == Some("error") {
        return create_json_rpc_success(id, run_result);
    }

    let finalize_result = match finalize_provider_result(&params, &run_result, cwd.clone(), aborted)
    {
        Ok(result) => result,
        Err(response) => return response.with_id(id),
    };

    let needs_autofix =
        finalize_result.get("status").and_then(Value::as_str) == Some("needs-autofix");
    let final_result = if needs_autofix {
        let autofixed_args_by_index = autofixed_args_by_index(&params, &finalize_result);
        match finalize_provider_result_with_autofix(
            &params,
            &run_result,
            cwd,
            aborted,
            autofixed_args_by_index,
        ) {
            Ok(result) => result,
            Err(response) => return response.with_id(id),
        }
    } else {
        finalize_result
    };

    create_json_rpc_success(
        id,
        complete_result_json(run_result, final_result, needs_autofix),
    )
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

fn provider_run_result(mut params: Map<String, Value>) -> Result<Value, JsonRpcResponse> {
    params.remove("cwd");
    params.remove("aborted");
    params.remove("autofixJson");
    let Ok(params) = serde_json::from_value::<ProviderCompilerRequestParams>(Value::Object(params))
    else {
        return Err(create_json_rpc_error(
            JsonRpcId::String("provider-run".into()),
            INVALID_PARAMS,
            "Invalid params",
            None,
        ));
    };

    let plan = provider_compiler_plan_json(ProviderCompilerPlanParams {
        provider_type: params.provider_type,
        base_url: params.base_url,
        model: params.model,
        context: params.context,
        reasoning: params.reasoning,
        modalities: params.modalities,
    });
    let Ok(plan) = serde_json::from_value::<ProviderHttpRequestPlanParam>(Value::Object(plan))
    else {
        return Err(create_json_rpc_error(
            JsonRpcId::String("provider-run".into()),
            INVALID_PARAMS,
            "Invalid params",
            None,
        ));
    };
    let tools_enabled = params.tools.as_ref().is_some_and(|tools| !tools.is_empty());
    let Ok((provider, assistant_output_provider, request, curl)) =
        provider_http_request_parts(ProviderHttpRequestParams {
            plan,
            api_key: params.api_key,
            irs: params.irs,
            system: params.system,
            tools: params.tools,
        })
    else {
        return Err(create_json_rpc_error(
            JsonRpcId::String("provider-run".into()),
            INVALID_PARAMS,
            "Invalid params",
            None,
        ));
    };

    match provider_http_events_result_json(
        provider,
        assistant_output_provider,
        tools_enabled,
        provider_http_stream_request(&request),
    ) {
        Ok(mut result) => {
            if let Value::Object(object) = &mut result {
                object.insert("curl".into(), Value::String(curl));
            }
            Ok(result)
        }
        Err(error) => Ok(provider_request_error_result_json(
            provider,
            curl,
            error.message,
            error.headers,
            error.status_code,
        )),
    }
}

fn provider_request_error_result_json(
    provider: &str,
    curl: String,
    message: String,
    headers: Map<String, Value>,
    status_code: Option<u16>,
) -> Value {
    let usage = json!({
        "input": { "cached": 0, "uncached": 0, "total": 0 },
        "output": 0,
    });
    let error_type = match status_code {
        Some(402) => "payment-error",
        Some(429) => "rate-limit-error",
        _ => "request-error",
    };
    json!({
        "status": "error",
        "provider": provider,
        "events": [],
        "state": {
            "content": "",
            "reasoningContent": null,
            "usage": {
                "input": 0,
                "cachedInput": 0,
                "output": 0,
                "reasoningOutput": 0,
            },
            "tools": [],
            "openai": {
                "reasoningId": null,
                "encryptedReasoningContent": null,
            },
            "anthropic": {
                "thinkingBlocks": [],
            },
        },
        "unexpectedToolCall": false,
        "output": {
            "role": "assistant",
            "content": "",
            "usage": usage,
        },
        "usage": usage,
        "headers": headers,
        "curl": curl,
        "error": {
            "type": error_type,
            "requestError": message,
            "curl": curl,
            "usage": usage,
        },
    })
}

fn finalize_provider_result(
    params: &Map<String, Value>,
    run_result: &Value,
    cwd: Value,
    aborted: bool,
) -> Result<Value, JsonRpcResponse> {
    finalize_provider_result_with_autofix(params, run_result, cwd, aborted, BTreeMap::new())
}

fn finalize_provider_result_with_autofix(
    params: &Map<String, Value>,
    run_result: &Value,
    cwd: Value,
    aborted: bool,
    autofixed_args_by_index: BTreeMap<String, Value>,
) -> Result<Value, JsonRpcResponse> {
    let Some(provider) = run_result.get("provider").cloned() else {
        return Err(create_json_rpc_error(
            JsonRpcId::String("provider-finalize".into()),
            INVALID_PARAMS,
            "Invalid params",
            None,
        ));
    };
    let tools = run_result
        .get("state")
        .and_then(|state| state.get("tools"))
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let finalize_params = json!({
        "provider": provider,
        "toolsEnabled": tools_enabled(params),
        "unexpectedToolCall": run_result.get("unexpectedToolCall").cloned().unwrap_or(Value::Bool(false)),
        "aborted": aborted,
        "curl": run_result.get("curl").cloned().unwrap_or(Value::String(String::new())),
        "usage": run_result.get("usage").cloned().unwrap_or(Value::Null),
        "output": run_result.get("output").cloned().unwrap_or(Value::Null),
        "tools": tools,
        "availableTools": available_tools(params),
        "cwd": cwd,
        "autofixedArgsByIndex": autofixed_args_by_index,
    });

    match provider_compiler_finalize_response(
        JsonRpcId::String("provider-finalize".into()),
        Some(finalize_params),
    ) {
        JsonRpcResponse::Success { result, .. } => Ok(result),
        error @ JsonRpcResponse::Error { .. } => Err(error),
    }
}

fn tools_enabled(params: &Map<String, Value>) -> bool {
    params
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty())
}

fn available_tools(params: &Map<String, Value>) -> Value {
    let tools = params
        .get("tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Value::Array(
        tools
            .into_iter()
            .map(|tool| {
                json!({
                    "name": tool.get("name").cloned().unwrap_or(Value::Null),
                    "schema": tool.get("schema").cloned().unwrap_or(Value::Null),
                })
            })
            .collect(),
    )
}

fn autofixed_args_by_index(
    params: &Map<String, Value>,
    finalize_result: &Value,
) -> BTreeMap<String, Value> {
    let requests = finalize_result
        .get("requests")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut output = BTreeMap::new();
    for request in requests {
        let Some(index) = request.get("index").and_then(Value::as_u64) else {
            continue;
        };
        let bad_json = request
            .get("badJson")
            .and_then(Value::as_str)
            .unwrap_or_default();
        output.insert(index.to_string(), autofix_json(params, bad_json));
    }
    output
}

fn autofix_json(params: &Map<String, Value>, bad_json: &str) -> Value {
    let Some(Value::Object(config)) = params.get("autofixJson") else {
        return Value::String(bad_json.to_string());
    };
    let Some(api_key) = autofix_api_key(config) else {
        return Value::String(bad_json.to_string());
    };
    let response = autofix_json_response(
        JsonRpcId::String("autofix-json".into()),
        Some(json!({
            "baseUrl": config.get("baseUrl").cloned().unwrap_or(Value::Null),
            "apiKey": api_key,
            "model": config.get("model").cloned().unwrap_or(Value::Null),
            "brokenJson": bad_json,
        })),
    );
    match response {
        JsonRpcResponse::Success { result, .. } => {
            if result.get("success").and_then(Value::as_bool) == Some(true) {
                result.get("fixed").cloned().unwrap_or(Value::Null)
            } else {
                Value::String(bad_json.to_string())
            }
        }
        JsonRpcResponse::Error { .. } => Value::String(bad_json.to_string()),
    }
}

fn autofix_api_key(config: &Map<String, Value>) -> Option<String> {
    if let Some(api_key) = config.get("apiKey").and_then(Value::as_str) {
        if !api_key.is_empty() {
            return Some(api_key.to_string());
        }
    }

    if let Some(auth_key) = auth_api_key(config.get("auth")) {
        return Some(auth_key);
    }

    if let Some(env_var_key) = env_var_api_key(config.get("apiEnvVar")) {
        return Some(env_var_key);
    }

    let base_url = config.get("baseUrl").and_then(Value::as_str)?;
    if let Some(default_env_key) = default_env_api_key(base_url, config) {
        return Some(default_env_key);
    }

    if let Some(key_file_key) = key_file_api_key(base_url) {
        return Some(key_file_key);
    }

    configured_model_api_key(base_url, config)
}

fn env_var_api_key(value: Option<&Value>) -> Option<String> {
    let env_var = value.and_then(Value::as_str)?;
    let value = std::env::var(env_var).ok()?;
    if value.is_empty() { None } else { Some(value) }
}

fn default_env_api_key(base_url: &str, config: &Map<String, Value>) -> Option<String> {
    let overrides = config
        .get("defaultApiKeyOverrides")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                .collect::<BTreeMap<_, _>>()
        });
    let env_var =
        octofwen_config::auth::provider_env_var_for_base_url(base_url, overrides.as_ref())?;
    let value = std::env::var(env_var).ok()?;
    if value.is_empty() { None } else { Some(value) }
}

fn key_file_api_key(base_url: &str) -> Option<String> {
    let contents = std::fs::read_to_string(octofwen_config::paths::default_key_file()).ok()?;
    parse_key_file(&contents).get(base_url).cloned()
}

fn parse_key_file(contents: &str) -> BTreeMap<String, String> {
    json5::from_str::<Value>(contents)
        .or_else(|_| serde_json::from_str::<Value>(contents))
        .map(string_map)
        .unwrap_or_default()
}

fn string_map(value: Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn configured_model_api_key(base_url: &str, config: &Map<String, Value>) -> Option<String> {
    let models = config.get("authModels")?.as_array()?;
    for model in models {
        let Some(model) = model.as_object() else {
            continue;
        };
        if model.get("baseUrl").and_then(Value::as_str) != Some(base_url) {
            continue;
        }
        if let Some(auth_key) = auth_api_key(model.get("auth")) {
            return Some(auth_key);
        }
        if let Some(env_key) = env_var_api_key(model.get("apiEnvVar")) {
            return Some(env_key);
        }
    }
    None
}

fn auth_api_key(auth: Option<&Value>) -> Option<String> {
    let auth = auth?.as_object()?;
    match auth.get("type").and_then(Value::as_str)? {
        "env" => {
            let name = auth.get("name").and_then(Value::as_str)?;
            let value = std::env::var(name).ok()?;
            if value.is_empty() { None } else { Some(value) }
        }
        "command" => command_auth_api_key(auth),
        _ => None,
    }
}

fn command_auth_api_key(auth: &Map<String, Value>) -> Option<String> {
    let command = auth.get("command")?.as_array()?;
    let program = command.first()?.as_str()?;
    if program.is_empty() {
        return None;
    }
    let args = command
        .iter()
        .skip(1)
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut limited =
            stdout.take(octofwen_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES as u64 + 1);
        let mut buffer = Vec::new();
        let _ = limited.read_to_end(&mut buffer);
        let _ = sender.send(buffer);
    });
    let deadline =
        Instant::now() + Duration::from_millis(octofwen_config::auth::AUTH_COMMAND_TIMEOUT_MS);
    loop {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        match child.try_wait().ok()? {
            Some(status) => {
                if !status.success() {
                    return None;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                let output = receiver.recv_timeout(remaining).ok()?;
                if output.len() > octofwen_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES {
                    return None;
                }
                let stdout = String::from_utf8(output).ok()?;
                let key = stdout.trim();
                return if key.is_empty() {
                    None
                } else {
                    Some(key.to_string())
                };
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    }
}

fn complete_result_json(run_result: Value, final_result: Value, needs_autofix: bool) -> Value {
    let mut output = match run_result {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    if needs_autofix {
        let events = output
            .entry("events")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Value::Array(events) = events {
            events.push(json!({ "type": "autofixing-json" }));
        }
    }
    match final_result.get("status").and_then(Value::as_str) {
        Some("finished") => {
            output.insert("status".into(), Value::String("finished".into()));
            output.insert(
                "output".into(),
                final_result.get("output").cloned().unwrap_or(Value::Null),
            );
            Value::Object(output)
        }
        Some("error") => {
            output.insert("status".into(), Value::String("error".into()));
            output.insert(
                "error".into(),
                final_result.get("error").cloned().unwrap_or(Value::Null),
            );
            Value::Object(output)
        }
        _ => {
            output.insert("status".into(), Value::String("error".into()));
            output.insert(
                "error".into(),
                json!({
                    "type": "request-error",
                    "requestError": "Provider compiler complete did not finish after autofix retry",
                    "curl": output.get("curl").cloned().unwrap_or(Value::String(String::new())),
                    "usage": output.get("usage").cloned().unwrap_or(Value::Null),
                }),
            );
            Value::Object(output)
        }
    }
}
