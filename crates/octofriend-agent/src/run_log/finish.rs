use super::super::quota::quota_json;
use crate::run_events::{MALFORMED_BATCH_SKIP_REASON, parse_quota_from_headers};
use octofriend_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const INVALID_PARAMS: i64 = -32602;

type JsonValues = Vec<Value>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryFinishParams {
    irs: JsonValues,
    assistant_message: Option<Value>,
    tool_calls: Option<JsonValues>,
    retry_irs: Option<JsonValues>,
    validation_results: Option<Vec<ToolValidationResultParam>>,
    compiler_error: Option<TrajectoryCompilerErrorParam>,
    headers: Option<BTreeMap<String, String>>,
    buffer: Option<TrajectoryBufferParam>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
enum ToolValidationResultParam {
    Valid,
    Error { message: String, aborted: bool },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryCompilerErrorParam {
    #[serde(rename = "type")]
    error_type: String,
    request_error: String,
    curl: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryBufferParam {
    content: Option<String>,
    reasoning: Option<String>,
    tool: Option<String>,
}

pub(in crate::runtime) fn trajectory_finish_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<TrajectoryFinishParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    create_json_rpc_success(id, trajectory_finish_result_json(params))
}

fn trajectory_finish_result_json(params: TrajectoryFinishParams) -> Value {
    if let Some(buffer) = params.buffer {
        return json!({
            "irs": buffered_assistant_irs_json(params.irs, buffer),
            "reason": { "type": "needs-response" },
            "events": [],
        });
    }

    if let Some(error) = params.compiler_error {
        return json!({
            "irs": params.irs,
            "reason": compiler_error_finish_reason_json(error),
            "events": [],
        });
    }

    if let Some(headers) = params.headers {
        return json!({
            "irs": params.irs,
            "reason": { "type": "needs-response" },
            "events": quota_events_json(headers),
        });
    }

    if let Some(validation_results) = params.validation_results {
        let tool_calls = params.tool_calls.unwrap_or_default();
        let retry_irs = validation_retry_irs_json(tool_calls.clone(), validation_results);
        return validation_retry_finish_json(params.irs, tool_calls, retry_irs);
    }

    if let Some(retry_irs) = params.retry_irs {
        return validation_retry_finish_json(
            params.irs,
            params.tool_calls.unwrap_or_default(),
            retry_irs,
        );
    }

    let Some(assistant_message) = params.assistant_message else {
        return json!({
            "irs": params.irs,
            "reason": { "type": "needs-response" },
            "events": [],
        });
    };

    let tool_calls = assistant_message
        .get("toolCalls")
        .and_then(Value::as_array)
        .cloned();
    let mut irs = params.irs;
    irs.push(assistant_message);

    let Some(tool_calls) = tool_calls else {
        return json!({
            "irs": irs,
            "reason": { "type": "needs-response" },
            "events": [],
        });
    };

    if tool_calls.iter().any(is_malformed_tool_request) {
        for tool_call in &tool_calls {
            if is_malformed_tool_request(tool_call) {
                irs.push(json!({
                    "role": "tool-parse-error",
                    "malformedRequest": tool_call,
                }));
            } else {
                irs.push(json!({
                    "role": "tool-skip-output",
                    "toolCall": tool_call,
                    "reason": MALFORMED_BATCH_SKIP_REASON,
                }));
            }
        }
        return json!({
            "irs": irs,
            "reason": { "type": "needs-response" },
            "events": [{ "type": "retry-tool", "irs": irs }],
        });
    }

    json!({
        "irs": irs,
        "reason": {
            "type": "request-tool",
            "toolCalls": tool_calls,
        },
        "events": [],
    })
}

fn validation_retry_finish_json(
    irs: JsonValues,
    tool_calls: JsonValues,
    retry_irs: JsonValues,
) -> Value {
    if retry_irs.iter().any(is_retryable_validation_failure) {
        let full_trajectory = irs.into_iter().chain(retry_irs).collect::<Vec<_>>();
        return json!({
            "irs": full_trajectory,
            "reason": { "type": "needs-response" },
            "events": [{ "type": "retry-tool", "irs": full_trajectory }],
        });
    }

    json!({
        "irs": irs,
        "reason": {
            "type": "request-tool",
            "toolCalls": tool_calls,
        },
        "events": [],
    })
}

fn validation_retry_irs_json(
    tool_calls: JsonValues,
    validation_results: Vec<ToolValidationResultParam>,
) -> JsonValues {
    tool_calls
        .into_iter()
        .zip(validation_results)
        .map(|(tool_call, validation_result)| match validation_result {
            ToolValidationResultParam::Valid => json!({
                "role": "tool-skip-output",
                "toolCall": tool_call,
                "reason": crate::run_events::SKIP_INVALID_REASON,
            }),
            ToolValidationResultParam::Error { message, aborted } => json!({
                "role": "tool-validation-error",
                "toolCall": tool_call,
                "error": message,
                "aborted": aborted,
            }),
        })
        .collect()
}

fn is_retryable_validation_failure(value: &Value) -> bool {
    value.get("role").and_then(Value::as_str) != Some("tool-skip-output")
}

fn is_malformed_tool_request(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("malformed-tool-request")
}

fn compiler_error_finish_reason_json(error: TrajectoryCompilerErrorParam) -> Value {
    match error.error_type.as_str() {
        "auth-error" | "payment-error" | "rate-limit-error" => json!({
            "type": error.error_type,
            "requestError": error.request_error,
            "curl": error.curl,
        }),
        _ => json!({
            "type": "request-error",
            "requestError": error.request_error,
            "curl": error.curl,
        }),
    }
}

fn quota_events_json(headers: BTreeMap<String, String>) -> JsonValues {
    let header_pairs = headers.into_iter().collect::<Vec<_>>();
    let Some(quota) = parse_quota_from_headers(&header_pairs) else {
        return Vec::new();
    };
    vec![json!({
        "type": "quota-updated",
        "quota": quota_json(quota),
    })]
}

fn buffered_assistant_irs_json(mut irs: JsonValues, buffer: TrajectoryBufferParam) -> JsonValues {
    let content = buffer.content.unwrap_or_default();
    let reasoning = buffer.reasoning.unwrap_or_default();
    let tool = buffer.tool.unwrap_or_default();
    if content.is_empty() && reasoning.is_empty() && tool.is_empty() {
        return Vec::new();
    }

    let mut assistant = serde_json::Map::from_iter([
        ("role".into(), Value::String("assistant".into())),
        ("content".into(), Value::String(content)),
        (
            "usage".into(),
            json!({
                "input": { "cached": 0, "uncached": 0, "total": 0 },
                "output": 0,
            }),
        ),
    ]);
    if !reasoning.is_empty() {
        assistant.insert("reasoningContent".into(), Value::String(reasoning));
    }
    irs.push(Value::Object(assistant));
    irs
}
