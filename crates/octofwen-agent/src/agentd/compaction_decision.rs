use crate::trajectory::compaction_checkpoint_content;
use octofwen_core::text::estimate_tokens;
use octofwen_llm::ir::ContentPart;
use octofwen_llm::prompts::compaction_prompt;
use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};

const INVALID_PARAMS: i64 = -32602;
const AUTOCOMPACT_THRESHOLD_NUMERATOR: usize = 9;
const AUTOCOMPACT_THRESHOLD_DENOMINATOR: usize = 10;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactionDecisionParams {
    max_context_window: usize,
    messages: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactionPrepareParams {
    messages: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactionCheckpointContentParams {
    output: Value,
}

pub(super) fn compaction_decision_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<CompactionDecisionParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let max_allowed_tokens = autocompact_max_allowed_tokens(params.max_context_window);
    let estimated_tokens = approximate_ts_ir_tokens(&params.messages);

    create_json_rpc_success(
        id,
        json!({
            "shouldCompact": estimated_tokens >= max_allowed_tokens,
            "estimatedTokens": estimated_tokens,
            "maxAllowedTokens": max_allowed_tokens,
        }),
    )
}

pub(super) fn compaction_prepare_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<CompactionPrepareParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let mut messages = params.messages;
    messages.push(json!({
        "role": "user",
        "content": [{ "type": "text", "content": compaction_prompt() }],
    }));

    create_json_rpc_success(id, json!({ "messages": messages }))
}

pub(super) fn compaction_checkpoint_content_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<CompactionCheckpointContentParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let Some(summary) = compacted_summary_from_ts_output(&params.output) else {
        return create_json_rpc_success(
            id,
            json!({
                "status": "empty",
                "message": "Compaction result was empty, continuing without compacting messages.",
            }),
        );
    };

    let Some(content) = compaction_checkpoint_content(summary) else {
        return create_json_rpc_success(
            id,
            json!({
                "status": "empty",
                "message": "Compaction result was empty, continuing without compacting messages.",
            }),
        );
    };

    create_json_rpc_success(
        id,
        json!({
            "status": "success",
            "content": content.into_iter().map(content_part_json).collect::<Vec<_>>(),
        }),
    )
}

fn autocompact_max_allowed_tokens(max_context_window: usize) -> usize {
    max_context_window.saturating_mul(AUTOCOMPACT_THRESHOLD_NUMERATOR)
        / AUTOCOMPACT_THRESHOLD_DENOMINATOR
}

fn approximate_ts_ir_tokens(messages: &[Value]) -> usize {
    let most_recent_assistant_index = messages
        .iter()
        .rposition(|message| role(message) == Some("assistant"));

    let checkpoint_token_count = most_recent_assistant_index
        .and_then(|index| {
            let usage = messages[index].get("usage")?;
            Some(
                usage
                    .get("input")?
                    .get("total")?
                    .as_u64()?
                    .saturating_add(usage.get("output")?.as_u64()?)
                    .try_into()
                    .unwrap_or(usize::MAX),
            )
        })
        .unwrap_or(0);

    let trailing_start = most_recent_assistant_index.map_or(0, |index| index + 1);
    let trailing_token_count = messages[trailing_start..]
        .iter()
        .map(|message| estimate_tokens(&message_text(message)))
        .sum::<usize>();

    checkpoint_token_count + trailing_token_count
}

fn role(message: &Value) -> Option<&str> {
    message.get("role").and_then(Value::as_str)
}

fn message_text(message: &Value) -> String {
    match role(message).unwrap_or_default() {
        "assistant" => {
            let content = message.get("content").and_then(Value::as_str).unwrap_or("");
            let reasoning = message
                .get("reasoningContent")
                .and_then(Value::as_str)
                .unwrap_or("");
            format!("{content}{reasoning}")
        }
        "user" | "tool-output" | "checkpoint" | "lowered-checkpoint" => {
            content_text(message.get("content").and_then(Value::as_array))
        }
        "tool-runtime-error" | "tool-validation-error" => message
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        "tool-parse-error" => {
            let arguments = message
                .get("malformedRequest")
                .and_then(|request| request.get("call"))
                .and_then(|call| call.get("original"))
                .and_then(|original| original.get("arguments"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let error = message
                .get("malformedRequest")
                .and_then(|request| request.get("error"))
                .and_then(Value::as_str)
                .unwrap_or("");
            format!("{arguments}{error}")
        }
        "tool-skip-output" => message
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

fn content_text(content: Option<&Vec<Value>>) -> String {
    content
        .map(|content| {
            content
                .iter()
                .map(|part| {
                    if part.get("type").and_then(Value::as_str) == Some("text") {
                        return part
                            .get("content")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                    }
                    let file_path = part
                        .get("image")
                        .and_then(|image| image.get("filePath"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    format!("Image file: {file_path}")
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn compacted_summary_from_ts_output(output: &Value) -> Option<&str> {
    output
        .get("content")
        .and_then(Value::as_str)
        .filter(|content| !content.is_empty())
        .or_else(|| {
            output
                .get("reasoningContent")
                .and_then(Value::as_str)
                .filter(|reasoning| !reasoning.is_empty())
        })
}

fn content_part_json(part: ContentPart) -> Value {
    match part {
        ContentPart::Text { content } => json!({ "type": "text", "content": content }),
        ContentPart::Image { image } => json!({
            "type": "image",
            "image": {
                "filePath": image.file_path,
                "mimeType": image.mime_type,
                "base64Data": image.base64_data,
                "dataUrl": image.data_url,
                "sizeBytes": image.size_bytes,
            },
        }),
    }
}
