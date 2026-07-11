use std::collections::BTreeMap;

use octofriend_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde_json::{Map, Value, json};

use super::super::INVALID_PARAMS;
use super::super::autofix::autofix_json_response;
use super::super::model_plan::{
    ProviderCompilerPlanParams, ProviderCompilerRequestParams, ProviderHttpRequestParams,
    ProviderHttpRequestPlanParam, provider_compiler_plan_json, provider_http_request_parts,
    provider_http_stream_request,
};
use super::auth_keys::autofix_api_key;
use super::http_stream::provider_http_events_result_json;
use super::provider_compiler_finalize_response;

type JsonObject = Map<String, Value>;
type JsonValueMap = BTreeMap<String, Value>;

pub(in crate::runtime) fn provider_compiler_complete_response(
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

    let finalize_result = match finalize_provider_result_with_autofix(
        &params,
        &run_result,
        cwd.clone(),
        aborted,
        JsonValueMap::new(),
    ) {
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
                jsonrpc: octofriend_wire::json_rpc::JSON_RPC_VERSION,
                id,
                error,
            },
        }
    }
}

fn provider_run_result(mut params: JsonObject) -> Result<Value, JsonRpcResponse> {
    params.remove("cwd");
    params.remove("aborted");
    params.remove("fixJson");
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
        thinking_budget_tokens: params.thinking_budget_tokens,
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
    headers: JsonObject,
    status_code: Option<u16>,
) -> Value {
    let usage = json!({
        "input": { "cached": 0, "uncached": 0, "total": 0 },
        "output": 0,
    });
    let error_type = match status_code {
        Some(401 | 403) => "auth-error",
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

fn finalize_provider_result_with_autofix(
    params: &JsonObject,
    run_result: &Value,
    cwd: Value,
    aborted: bool,
    autofixed_args_by_index: JsonValueMap,
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

fn tools_enabled(params: &JsonObject) -> bool {
    params
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty())
}

fn available_tools(params: &JsonObject) -> Value {
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

fn autofixed_args_by_index(params: &JsonObject, finalize_result: &Value) -> JsonValueMap {
    let requests = finalize_result
        .get("requests")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut output = JsonValueMap::new();
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

fn autofix_json(params: &JsonObject, bad_json: &str) -> Value {
    let Some(Value::Object(config)) = params.get("fixJson").or_else(|| params.get("autofixJson"))
    else {
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
