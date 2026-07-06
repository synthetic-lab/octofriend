use crate::prompts::{image_attachment_placeholder_text, tool_skip};
use serde_json::{Value, json};

pub fn anthropic_messages_from_ts_ir(
    irs: &[Value],
    modalities: Option<&[String]>,
) -> Result<Value, String> {
    let messages = irs
        .iter()
        .map(|ir| anthropic_message_from_ts_ir(ir, modalities))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(messages))
}

fn anthropic_message_from_ts_ir(
    ir: &Value,
    modalities: Option<&[String]>,
) -> Result<Value, String> {
    match string_field(ir, "role").unwrap_or_default() {
        "assistant" => Ok(json!({
            "role": "assistant",
            "content": assistant_content(ir),
        })),
        "user" | "lowered-checkpoint" => Ok(json!({
            "role": "user",
            "content": anthropic_content_parts(ir.get("content"), modalities),
        })),
        "tool-output" => Ok(json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_call_id(ir.get("toolCall")),
                "content": anthropic_content_parts(ir.get("content"), modalities),
            }],
        })),
        "tool-skip-output" => Ok(json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_call_id(ir.get("toolCall")),
                "is_error": true,
                "content": tool_skip(string_field(ir, "reason").unwrap_or_default()),
            }],
        })),
        "tool-runtime-error" | "tool-validation-error" => Ok(json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_call_id(ir.get("toolCall")),
                "is_error": true,
                "content": format!("Error: {}", string_field(ir, "error").unwrap_or_default()),
            }],
        })),
        "tool-parse-error" => Ok(json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_call_id(ir.get("malformedRequest")),
                "is_error": true,
                "content": format!("Error: {}", nested_string_field(ir, "malformedRequest", "error")),
            }],
        })),
        role => Err(format!("Unsupported IR role: {role}")),
    }
}

fn assistant_content(ir: &Value) -> Vec<Value> {
    let mut content = Vec::new();
    if let Some(thinking_blocks) = ir
        .get("anthropic")
        .and_then(|anthropic| anthropic.get("thinkingBlocks"))
        .and_then(Value::as_array)
    {
        content.extend(thinking_blocks.iter().cloned());
    }

    content.push(json!({
        "type": "text",
        "text": match string_field(ir, "content") {
            Some("") | None => " ",
            Some(content) => content,
        },
    }));

    if let Some(tool_calls) = ir.get("toolCalls").and_then(Value::as_array) {
        content.extend(
            tool_calls
                .iter()
                .filter(|tool_call| string_field(tool_call, "type") == Some("tool-call"))
                .map(|tool_call| {
                    json!({
                        "type": "tool_use",
                        "id": string_field(tool_call, "toolCallId").unwrap_or_default(),
                        "name": string_field(tool_call, "name").unwrap_or_default(),
                        "input": tool_call.get("original").cloned().unwrap_or_else(|| json!({})),
                    })
                }),
        );
    }

    content
}

fn anthropic_content_parts(content: Option<&Value>, modalities: Option<&[String]>) -> Vec<Value> {
    let Some(parts) = content.and_then(Value::as_array) else {
        return Vec::new();
    };
    parts
        .iter()
        .map(|part| anthropic_content_part(part, modalities))
        .collect()
}

fn anthropic_content_part(part: &Value, modalities: Option<&[String]>) -> Value {
    if string_field(part, "type") == Some("text") {
        return json!({
            "type": "text",
            "text": string_field(part, "content").unwrap_or_default(),
        });
    }

    if supports_vision(modalities) {
        return json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": nested_string_field(part, "image", "mimeType"),
                "data": nested_string_field(part, "image", "base64Data"),
            },
        });
    }

    json!({
        "type": "text",
        "text": image_attachment_placeholder_text(),
    })
}

fn supports_vision(modalities: Option<&[String]>) -> bool {
    modalities
        .unwrap_or_default()
        .iter()
        .any(|modality| modality == "vision")
}

fn tool_call_id(value: Option<&Value>) -> &str {
    value
        .and_then(|value| value.get("toolCallId"))
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn nested_string_field<'a>(
    value: &'a Value,
    object_field: &str,
    string_field_name: &str,
) -> &'a str {
    value
        .get(object_field)
        .and_then(|object| object.get(string_field_name))
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

pub fn openai_chat_completions_messages_from_ts_ir(
    irs: &[Value],
    system_prompt: Option<&str>,
    modalities: Option<&[String]>,
) -> Result<Value, String> {
    let mut messages = Vec::new();
    if let Some(system_prompt) = system_prompt {
        messages.push(json!({
            "role": "system",
            "content": system_prompt,
        }));
    }
    messages.extend(
        irs.iter()
            .map(|ir| openai_chat_completion_message_from_ts_ir(ir, modalities))
            .collect::<Result<Vec<_>, _>>()?,
    );
    Ok(Value::Array(messages))
}

fn openai_chat_completion_message_from_ts_ir(
    ir: &Value,
    modalities: Option<&[String]>,
) -> Result<Value, String> {
    match string_field(ir, "role").unwrap_or_default() {
        "assistant" => Ok(openai_assistant_message(ir)),
        "user" | "lowered-checkpoint" => Ok(json!({
            "role": "user",
            "content": openai_content_parts(ir.get("content"), modalities),
        })),
        "tool-output" => Ok(json!({
            "role": "tool",
            "tool_call_id": tool_call_id(ir.get("toolCall")),
            "content": openai_content_parts(ir.get("content"), modalities),
        })),
        "tool-skip-output" => Ok(json!({
            "role": "tool",
            "tool_call_id": tool_call_id(ir.get("toolCall")),
            "content": [{
                "type": "text",
                "text": tagged_tool_error(&tool_skip(string_field(ir, "reason").unwrap_or_default())),
            }],
        })),
        "tool-parse-error" => Ok(json!({
            "role": "tool",
            "tool_call_id": tool_call_id(ir.get("malformedRequest")),
            "content": [{
                "type": "text",
                "text": format!(
                    "Malformed tool call: {}",
                    tagged_tool_error(nested_string_field(ir, "malformedRequest", "error")),
                ),
            }],
        })),
        "tool-validation-error" => Ok(json!({
            "role": "tool",
            "tool_call_id": tool_call_id(ir.get("toolCall")),
            "content": [{
                "type": "text",
                "text": format!(
                    "Error from tool call validation: {}",
                    tagged_tool_error(string_field(ir, "error").unwrap_or_default()),
                ),
            }],
        })),
        "tool-runtime-error" => Ok(json!({
            "role": "tool",
            "tool_call_id": tool_call_id(ir.get("toolCall")),
            "content": [{
                "type": "text",
                "text": format!(
                    "Error: {}",
                    tagged_tool_error(string_field(ir, "error").unwrap_or_default()),
                ),
            }],
        })),
        role => Err(format!("Unsupported IR role: {role}")),
    }
}

fn openai_assistant_message(ir: &Value) -> Value {
    let tool_calls = ir.get("toolCalls").and_then(Value::as_array);
    let has_tool_calls = tool_calls.is_some_and(|tool_calls| !tool_calls.is_empty());
    let mut message = serde_json::Map::new();
    if let Some(reasoning_content) = string_field(ir, "reasoningContent") {
        message.insert(
            "reasoning_content".into(),
            Value::String(reasoning_content.into()),
        );
    }
    message.insert("role".into(), Value::String("assistant".into()));
    message.insert(
        "content".into(),
        Value::String(
            if has_tool_calls {
                string_field(ir, "content").unwrap_or_default()
            } else {
                match string_field(ir, "content") {
                    Some("") | None => " ",
                    Some(content) => content,
                }
            }
            .into(),
        ),
    );
    if let Some(tool_calls) = tool_calls {
        if !tool_calls.is_empty() {
            message.insert(
                "tool_calls".into(),
                Value::Array(
                    tool_calls
                        .iter()
                        .filter(|tool_call| string_field(tool_call, "type") == Some("tool-call"))
                        .map(openai_tool_call)
                        .collect(),
                ),
            );
        }
    }
    Value::Object(message)
}

fn openai_tool_call(tool_call: &Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": string_field(tool_call, "name").unwrap_or_default(),
            "arguments": tool_call
                .get("original")
                .map(|original| serde_json::to_string(original).expect("serializing serde_json::Value cannot fail"))
                .unwrap_or_else(|| "{}".into()),
        },
        "id": string_field(tool_call, "toolCallId").unwrap_or_default(),
    })
}

fn openai_content_parts(content: Option<&Value>, modalities: Option<&[String]>) -> Vec<Value> {
    let Some(parts) = content.and_then(Value::as_array) else {
        return Vec::new();
    };
    parts
        .iter()
        .map(|part| openai_content_part(part, modalities))
        .collect()
}

fn openai_content_part(part: &Value, modalities: Option<&[String]>) -> Value {
    if string_field(part, "type") == Some("text") {
        return json!({
            "type": "text",
            "text": string_field(part, "content").unwrap_or_default(),
        });
    }
    if supports_vision(modalities) {
        return json!({
            "type": "image_url",
            "image_url": {
                "url": nested_string_field(part, "image", "dataUrl"),
            },
        });
    }
    json!({
        "type": "text",
        "text": image_attachment_placeholder_text(),
    })
}

fn tagged_tool_error(content: &str) -> String {
    crate::prompts::tagged("tool-runtime-error", &[], &[content])
}

pub fn openai_responses_input_from_ts_ir(
    irs: &[Value],
    modalities: Option<&[String]>,
) -> Result<Value, String> {
    let input = irs
        .iter()
        .map(|ir| openai_response_input_from_ts_ir(ir, modalities))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    Ok(Value::Array(input))
}

fn openai_response_input_from_ts_ir(
    ir: &Value,
    modalities: Option<&[String]>,
) -> Result<Vec<Value>, String> {
    match string_field(ir, "role").unwrap_or_default() {
        "assistant" => Ok(openai_response_assistant_input(ir)),
        "user" | "lowered-checkpoint" => Ok(vec![json!({
            "role": "user",
            "content": response_content_parts(ir.get("content"), modalities),
        })]),
        "tool-output" => Ok(vec![json!({
            "type": "function_call_output",
            "call_id": tool_call_id(ir.get("toolCall")),
            "output": response_tool_output(ir.get("content"), modalities),
        })]),
        "tool-skip-output" => Ok(vec![json!({
            "type": "function_call_output",
            "call_id": tool_call_id(ir.get("toolCall")),
            "output": tool_skip(string_field(ir, "reason").unwrap_or_default()),
        })]),
        "tool-runtime-error" | "tool-validation-error" => Ok(vec![json!({
            "type": "function_call_output",
            "call_id": tool_call_id(ir.get("toolCall")),
            "output": format!("Error: {}", string_field(ir, "error").unwrap_or_default()),
        })]),
        "tool-parse-error" => Ok(vec![json!({
            "type": "function_call_output",
            "call_id": tool_call_id(ir.get("malformedRequest")),
            "output": format!("Error: {}", nested_string_field(ir, "malformedRequest", "error")),
        })]),
        role => Err(format!("Unsupported IR role: {role}")),
    }
}

fn openai_response_assistant_input(ir: &Value) -> Vec<Value> {
    let mut output = Vec::new();
    if ir
        .get("openai")
        .and_then(|openai| openai.get("encryptedReasoningContent"))
        .and_then(Value::as_str)
        .is_some()
        || ir
            .get("openai")
            .and_then(|openai| openai.get("reasoningId"))
            .and_then(Value::as_str)
            .is_some()
    {
        output.push(json!({
            "type": "reasoning",
            "id": nested_string_field(ir, "openai", "reasoningId"),
            "summary": [],
            "encrypted_content": ir
                .get("openai")
                .and_then(|openai| openai.get("encryptedReasoningContent"))
                .cloned()
                .unwrap_or(Value::Null),
        }));
    }

    let tool_calls = ir.get("toolCalls").and_then(Value::as_array);
    if string_field(ir, "content").is_some_and(|content| !content.is_empty())
        || string_field(ir, "reasoningContent").is_some_and(|content| !content.is_empty())
        || tool_calls.is_none_or(|tool_calls| tool_calls.is_empty())
    {
        output.push(json!({
            "role": "assistant",
            "content": match string_field(ir, "content") {
                Some("") | None => " ",
                Some(content) => content,
            },
        }));
    }

    if let Some(tool_calls) = tool_calls {
        output.extend(
            tool_calls
                .iter()
                .filter(|tool_call| string_field(tool_call, "type") == Some("tool-call"))
                .map(|tool_call| {
                    json!({
                        "type": "function_call",
                        "call_id": string_field(tool_call, "toolCallId").unwrap_or_default(),
                        "name": string_field(tool_call, "name").unwrap_or_default(),
                        "arguments": tool_call
                            .get("original")
                            .map(|original| serde_json::to_string(original).expect("serializing serde_json::Value cannot fail"))
                            .unwrap_or_else(|| "{}".into()),
                    })
                }),
        );
    }

    output
}

fn response_content_parts(content: Option<&Value>, modalities: Option<&[String]>) -> Vec<Value> {
    let Some(parts) = content.and_then(Value::as_array) else {
        return Vec::new();
    };
    parts
        .iter()
        .map(|part| response_content_part(part, modalities))
        .collect()
}

fn response_content_part(part: &Value, modalities: Option<&[String]>) -> Value {
    if string_field(part, "type") == Some("text") {
        return json!({
            "type": "input_text",
            "text": string_field(part, "content").unwrap_or_default(),
        });
    }
    if supports_vision(modalities) {
        return json!({
            "type": "input_image",
            "detail": "auto",
            "image_url": nested_string_field(part, "image", "dataUrl"),
        });
    }
    json!({
        "type": "input_text",
        "text": image_attachment_placeholder_text(),
    })
}

fn response_tool_output(content: Option<&Value>, modalities: Option<&[String]>) -> String {
    let Some(parts) = content.and_then(Value::as_array) else {
        return String::new();
    };
    let visible_parts = parts
        .iter()
        .map(|part| {
            if string_field(part, "type") == Some("text") {
                return json!({ "type": "text", "text": string_field(part, "content").unwrap_or_default() });
            }
            if !supports_vision(modalities) {
                return json!({ "type": "text", "text": image_attachment_placeholder_text() });
            }
            json!({
                "type": "image",
                "mimeType": nested_string_field(part, "image", "mimeType"),
                "dataUrl": nested_string_field(part, "image", "dataUrl"),
            })
        })
        .collect::<Vec<_>>();

    if visible_parts
        .iter()
        .all(|part| string_field(part, "type") == Some("text"))
    {
        return visible_parts
            .iter()
            .map(|part| string_field(part, "text").unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n");
    }

    serde_json::to_string(&visible_parts).expect("serializing serde_json::Value cannot fail")
}
