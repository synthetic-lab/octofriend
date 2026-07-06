use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{Map, Value, json};

use crate::mcp::{
    ModelContextResourceContents, ModelContextToolResult, ModelContextToolResultContent,
    RenderedModelContextToolResult, model_context_error_message, render_model_context_tool_result,
};

use super::super::tool::{output_text, required_string};

pub(crate) fn run_mcp(cwd: &Path, parsed: &Value) -> Result<Value, String> {
    let server_name = required_string(parsed, "server")?;
    let tool_name = required_string(parsed, "tool")?;
    let server_config = resolve_mcp_server_config(server_name, parsed)?;
    let arguments = optional_string_map(parsed, "arguments")?;
    let max_content_bytes = parsed
        .get("modelContext")
        .and_then(Value::as_u64)
        .ok_or_else(|| "mcp tool argument modelContext must be a number".to_owned())?
        as usize;

    let mut child = Command::new(&server_config.command)
        .args(&server_config.args)
        .current_dir(cwd)
        .envs(&server_config.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| model_context_error_message(error))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "MCP error: failed to open server stdin".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "MCP error: failed to open server stdout".to_owned())?;
    let mut reader = BufReader::new(stdout);

    let run_result = run_mcp_session(
        &mut stdin,
        &mut reader,
        server_name,
        tool_name,
        &arguments,
        max_content_bytes,
    );

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();

    run_result
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct McpServerRunConfig {
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
}

fn resolve_mcp_server_config(
    server_name: &str,
    parsed: &Value,
) -> Result<McpServerRunConfig, String> {
    if let Some(command) = optional_string(parsed, "serverCommand")? {
        return Ok(McpServerRunConfig {
            command: command.to_owned(),
            args: optional_string_array(parsed, "serverArgs")?,
            env: optional_string_map(parsed, "serverEnv")?,
        });
    }

    let servers = parsed
        .get("mcpServers")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "MCP server \"{server_name}\" not found in config. Please add it to mcpServers."
            )
        })?;
    let server = servers
        .get(server_name)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "MCP server \"{server_name}\" not found in config. Please add it to mcpServers."
            )
        })?;
    let command = server
        .get("command")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("mcp server config {server_name}.command must be a string"))?;
    let args = optional_object_string_array(server, "args")?;
    let env = optional_object_string_map(server, "env")?;
    Ok(McpServerRunConfig { command, args, env })
}

fn run_mcp_session(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    server_name: &str,
    tool_name: &str,
    arguments: &BTreeMap<String, String>,
    max_content_bytes: usize,
) -> Result<Value, String> {
    let _ = send_request(
        stdin,
        reader,
        1,
        "initialize",
        json!({
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": { "name": "octofwen", "version": "1.0.0" }
        }),
    )?;
    send_notification(stdin, "notifications/initialized", json!({}))?;

    let listed = send_request(stdin, reader, 2, "tools/list", json!({}))?;
    let tools = listed
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "MCP error: tools/list response did not include tools".to_owned())?;
    if !tools
        .iter()
        .any(|tool| tool.get("name").and_then(Value::as_str) == Some(tool_name))
    {
        let available = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Tool \"{tool_name}\" not found in MCP server \"{server_name}\". Available tools: {available}"
        ));
    }

    let called = send_request(
        stdin,
        reader,
        3,
        "tools/call",
        json!({ "name": tool_name, "arguments": arguments }),
    )?;
    let result = model_context_tool_result_from_json(&called)?;
    match render_model_context_tool_result(&result, max_content_bytes) {
        RenderedModelContextToolResult::Success { output } => Ok(output_text(output, None)),
        RenderedModelContextToolResult::Error { error } => Err(error),
    }
}

fn send_request(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    write_json_line(
        stdin,
        &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
    )?;

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|error| model_context_error_message(error))?;
        if bytes == 0 {
            return Err("MCP error: server closed stdout before responding".to_owned());
        }
        let message: Value = serde_json::from_str(line.trim())
            .map_err(|error| format!("MCP error: invalid JSON-RPC response: {error}"))?;
        if message.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            return Err(format!("MCP error: {error}"));
        }
        return message
            .get("result")
            .cloned()
            .ok_or_else(|| "MCP error: JSON-RPC response missing result".to_owned());
    }
}

fn send_notification(stdin: &mut ChildStdin, method: &str, params: Value) -> Result<(), String> {
    write_json_line(
        stdin,
        &json!({ "jsonrpc": "2.0", "method": method, "params": params }),
    )
}

fn write_json_line(stdin: &mut ChildStdin, message: &Value) -> Result<(), String> {
    let line = serde_json::to_string(message)
        .map_err(|error| format!("MCP error: failed to encode JSON-RPC message: {error}"))?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| model_context_error_message(error))
}

fn model_context_tool_result_from_json(value: &Value) -> Result<ModelContextToolResult, String> {
    let content = value
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| "MCP error: tools/call response did not include content".to_owned())?
        .iter()
        .map(model_context_content_from_json)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ModelContextToolResult { content })
}

fn model_context_content_from_json(value: &Value) -> Result<ModelContextToolResultContent, String> {
    let content_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "MCP error: content item missing type".to_owned())?;
    match content_type {
        "text" => Ok(ModelContextToolResultContent::Text {
            text: required_json_string(value, "text")?,
        }),
        "image" => Ok(ModelContextToolResultContent::Image {
            mime_type: required_json_string(value, "mimeType")?,
            data: required_json_string(value, "data")?,
        }),
        "audio" => Ok(ModelContextToolResultContent::Audio {
            mime_type: required_json_string(value, "mimeType")?,
            data: required_json_string(value, "data")?,
        }),
        "resource_link" => Ok(ModelContextToolResultContent::ResourceLink {
            uri: required_json_string(value, "uri")?,
            mime_type: optional_json_string(value, "mimeType"),
        }),
        "resource" => resource_content_from_json(value),
        other => Err(format!("MCP error: unsupported content type {other}")),
    }
}

fn resource_content_from_json(value: &Value) -> Result<ModelContextToolResultContent, String> {
    let resource = value
        .get("resource")
        .and_then(Value::as_object)
        .ok_or_else(|| "MCP error: resource content missing resource".to_owned())?;
    let contents = ModelContextResourceContents {
        uri: required_object_string(resource, "uri")?,
        mime_type: optional_object_string(resource, "mimeType"),
    };
    if let Some(text) = resource.get("text").and_then(Value::as_str) {
        return Ok(ModelContextToolResultContent::ResourceText {
            resource: contents,
            text: text.to_owned(),
        });
    }
    if let Some(blob) = resource.get("blob").and_then(Value::as_str) {
        return Ok(ModelContextToolResultContent::ResourceBlob {
            resource: contents,
            blob: blob.to_owned(),
        });
    }
    Err("MCP error: resource content missing text or blob".to_owned())
}

fn optional_string<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(format!("mcp tool argument {key} must be a string")),
        None => Ok(None),
    }
}

fn optional_object_string_array(
    object: &Map<String, Value>,
    key: &str,
) -> Result<Vec<String>, String> {
    match object.get(key) {
        None => Ok(Vec::new()),
        Some(Value::Array(values)) => values
            .iter()
            .map(|item| {
                item.as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| format!("mcp server config {key} entries must be strings"))
            })
            .collect(),
        Some(_) => Err(format!("mcp server config {key} must be an array")),
    }
}

fn optional_object_string_map(
    object: &Map<String, Value>,
    key: &str,
) -> Result<BTreeMap<String, String>, String> {
    match object.get(key) {
        None => Ok(BTreeMap::new()),
        Some(Value::Object(values)) => values
            .iter()
            .map(|(entry_key, entry_value)| {
                entry_value
                    .as_str()
                    .map(|entry_value| (entry_key.clone(), entry_value.to_owned()))
                    .ok_or_else(|| format!("mcp server config {key}.{entry_key} must be a string"))
            })
            .collect(),
        Some(_) => Err(format!("mcp server config {key} must be an object")),
    }
}

fn optional_string_array(value: &Value, key: &str) -> Result<Vec<String>, String> {
    match value.get(key) {
        None => Ok(Vec::new()),
        Some(Value::Array(values)) => values
            .iter()
            .map(|item| {
                item.as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| format!("mcp tool argument {key} entries must be strings"))
            })
            .collect(),
        Some(_) => Err(format!("mcp tool argument {key} must be an array")),
    }
}

fn optional_string_map(value: &Value, key: &str) -> Result<BTreeMap<String, String>, String> {
    match value.get(key) {
        None => Ok(BTreeMap::new()),
        Some(Value::Object(object)) => object
            .iter()
            .map(|(entry_key, entry_value)| {
                entry_value
                    .as_str()
                    .map(|entry_value| (entry_key.clone(), entry_value.to_owned()))
                    .ok_or_else(|| format!("mcp tool argument {key}.{entry_key} must be a string"))
            })
            .collect(),
        Some(_) => Err(format!("mcp tool argument {key} must be an object")),
    }
}

fn required_json_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("MCP error: content item missing {key}"))
}

fn optional_json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn required_object_string(object: &Map<String, Value>, key: &str) -> Result<String, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("MCP error: resource content missing {key}"))
}

fn optional_object_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}
