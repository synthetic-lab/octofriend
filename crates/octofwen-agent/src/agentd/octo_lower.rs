use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::HashSet;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OctoLowerParams {
    messages: Vec<Value>,
    modalities: Option<Value>,
}

pub(super) fn octo_lower_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<OctoLowerParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    match lower_octo_values(params.messages, params.modalities.as_ref()) {
        Ok(irs) => create_json_rpc_success(id, json!({ "irs": irs })),
        Err(message) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Invalid params",
            Some(json!({ "message": message })),
        ),
    }
}

fn lower_octo_values(
    messages: Vec<Value>,
    modalities: Option<&Value>,
) -> Result<Vec<Value>, String> {
    let rejected_messages = messages
        .into_iter()
        .map(lower_tool_reject)
        .collect::<Vec<_>>();
    lower_checkpointed_values(optimize_file_values(rejected_messages, modalities))
}

fn lower_tool_reject(message: Value) -> Value {
    if role(&message) != Some("tool-reject") {
        return message;
    }

    json!({
        "role": "tool-skip-output",
        "toolCall": message.get("toolCall").cloned().unwrap_or(Value::Null),
        "reason": "Tool call rejected by user.",
    })
}

fn optimize_file_values(messages: Vec<Value>, modalities: Option<&Value>) -> Vec<Value> {
    let mut output = Vec::new();
    let mut seen_paths = HashSet::new();

    for message in messages.into_iter().rev() {
        output.push(optimize_file_value(message, &mut seen_paths, modalities));
    }

    output.reverse();
    output
}

fn optimize_file_value(
    message: Value,
    seen_paths: &mut HashSet<String>,
    modalities: Option<&Value>,
) -> Value {
    match role(&message) {
        Some("file-read") => file_read_value(message, seen_paths, modalities),
        Some("file-mutate") => file_mutate_value(message),
        _ => message,
    }
}

fn file_read_value(
    message: Value,
    seen_paths: &mut HashSet<String>,
    modalities: Option<&Value>,
) -> Value {
    let path = message
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let seen_path = seen_paths.contains(&path);
    seen_paths.insert(path);

    let image = message.get("image");
    let image_check = image.map(|image| can_display_image(modalities, image));
    if let (Some(image), Some(ImageDisplayCheck::Accepted)) = (image, image_check.as_ref()) {
        return json!({
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "content": format!(
                        "[Tool result for call {}]: {content}",
                        tool_call_id(&message)
                    ),
                },
                {
                    "type": "image",
                    "image": image,
                },
            ],
        });
    }

    json!({
        "role": "tool-output",
        "toolCall": message.get("toolCall").cloned().unwrap_or(Value::Null),
        "content": [{
            "type": "text",
            "content": file_read_message(content, seen_path, image_check.as_ref()),
        }],
    })
}

fn file_mutate_value(message: Value) -> Value {
    let path = message
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default();
    json!({
        "role": "tool-output",
        "toolCall": message.get("toolCall").cloned().unwrap_or(Value::Null),
        "content": [{
            "type": "text",
            "content": format!("{path} was updated successfully."),
        }],
    })
}

fn lower_checkpointed_values(messages: Vec<Value>) -> Result<Vec<Value>, String> {
    let start = messages
        .iter()
        .rposition(|message| role(message) == Some("checkpoint"))
        .unwrap_or(0);
    let mut output = Vec::new();

    for message in messages.into_iter().skip(start) {
        match role(&message) {
            Some("checkpoint") => {
                let mut object = Map::new();
                object.insert("role".into(), Value::String("lowered-checkpoint".into()));
                object.insert(
                    "content".into(),
                    message.get("content").cloned().unwrap_or(Value::Null),
                );
                output.push(Value::Object(object));
            }
            Some("trajectory") => {
                return Err(
                    "Subagent trajectory entries cannot be lowered by checkpoint lowering".into(),
                );
            }
            _ => output.push(message),
        }
    }

    Ok(output)
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum ImageDisplayCheck {
    Accepted,
    Rejected { reason: String },
}

fn can_display_image(modalities: Option<&Value>, image: &Value) -> ImageDisplayCheck {
    let Some(image_config) = modalities.and_then(|value| value.get("image")) else {
        return ImageDisplayCheck::Rejected {
            reason: "Your model does not support image viewing.".into(),
        };
    };
    if !image_config
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return ImageDisplayCheck::Rejected {
            reason: "Your model does not support image viewing.".into(),
        };
    }

    let accepted_mime_types = image_config
        .get("acceptedMimeTypes")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let mime_type = image
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !accepted_mime_types
        .iter()
        .any(|accepted| accepted == &mime_type)
    {
        return ImageDisplayCheck::Rejected {
            reason: format!(
                "Your model does not support {} images. Supported formats: {}.",
                mime_type,
                accepted_mime_types.join(", ")
            ),
        };
    }

    if let (Some(size_bytes), Some(max_size_mb)) = (
        image.get("sizeBytes").and_then(Value::as_f64),
        image_config.get("maxSizeMB").and_then(Value::as_f64),
    ) {
        if size_bytes > max_size_mb * 1024.0 * 1024.0 {
            return ImageDisplayCheck::Rejected {
                reason: format!(
                    "Image file is too large ({:.1} MB). Maximum supported size is {} MB.",
                    size_bytes / (1024.0 * 1024.0),
                    format_max_size_mb(max_size_mb)
                ),
            };
        }
    }

    ImageDisplayCheck::Accepted
}

fn file_read_message(
    content: &str,
    seen_path: bool,
    image_check: Option<&ImageDisplayCheck>,
) -> String {
    match image_check {
        Some(ImageDisplayCheck::Rejected { reason }) => {
            format!(
                "{content}\n[An image file was read but could not be displayed: {reason} The image content has been omitted.]"
            )
        }
        _ if seen_path => "File was successfully read.".into(),
        _ => content.into(),
    }
}

fn role(value: &Value) -> Option<&str> {
    value.get("role").and_then(Value::as_str)
}

fn tool_call_id(value: &Value) -> &str {
    value
        .get("toolCall")
        .and_then(|tool_call| tool_call.get("toolCallId"))
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn format_max_size_mb(max_size_mb: f64) -> String {
    if max_size_mb.fract() == 0.0 {
        format!("{}", max_size_mb as u64)
    } else {
        max_size_mb.to_string()
    }
}
