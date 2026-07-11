use super::render_model_context_tool_result;
use super::rendering::{ModelContextToolResult, RenderedModelContextToolResult};
use super::{
    ConnectModelContextClientInput, ModelContextClientLifecycle, ModelContextClientRegistry,
    ModelContextResult,
};
use crate::runtime::{RuntimeTool, TOOL_BUILDER, ToolCall, ToolContent, ToolReturn};
use serde_json::{Map, Value, json};

pub const MODEL_CONTEXT_USER_ABORTED_ERROR_MESSAGE: &str = "User aborted";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContextToolSummary {
    pub name: String,
    pub description: Option<String>,
}

pub trait ModelContextToolClient {
    fn list_tools(&self) -> Vec<ModelContextToolSummary>;

    fn call_tool(
        &self,
        name: &str,
        arguments: &[(String, String)],
    ) -> Result<ModelContextToolResult, String>;
}

pub fn model_context_error_reason(error: impl ToString) -> String {
    error.to_string()
}

pub fn model_context_error_message(error: impl ToString) -> String {
    format!("MCP error: {}", model_context_error_reason(error))
}

pub fn call_model_context_tool(
    client: &impl ModelContextToolClient,
    server_name: Option<&str>,
    tool_name: &str,
    arguments: &[(String, String)],
    max_content_bytes: usize,
) -> RenderedModelContextToolResult {
    let listed_tools = client.list_tools();

    if !listed_tools
        .iter()
        .any(|candidate| candidate.name == tool_name)
    {
        return RenderedModelContextToolResult::Error {
            error: model_context_missing_tool_error(tool_name, server_name, &listed_tools),
        };
    }

    match client.call_tool(tool_name, arguments) {
        Ok(result) => render_model_context_tool_result(&result, max_content_bytes),
        Err(error) => RenderedModelContextToolResult::Error {
            error: model_context_error_message(error),
        },
    }
}

pub fn model_context_runtime_tool(has_mcp_servers: bool) -> Option<RuntimeTool> {
    TOOL_BUILDER.dynamic_define_tool(|| {
        has_mcp_servers.then(|| {
            TOOL_BUILDER
                .declare(
                    "mcp",
                    MODEL_CONTEXT_TOOL_DESCRIPTION,
                    model_context_tool_arguments_schema(),
                )
                .define()
        })
    })
}

pub fn run_model_context_runtime_tool<Client, Connect>(
    registry: &mut ModelContextClientRegistry<Client, Connect>,
    tool_call: &ToolCall,
    max_content_bytes: usize,
) -> Result<ToolReturn, String>
where
    Client: Clone + ModelContextClientLifecycle + ModelContextToolClient,
    Connect: FnMut(ConnectModelContextClientInput) -> Result<Client, String>,
{
    let arguments = model_context_tool_arguments(&tool_call.parsed)?;
    let client = match registry.get_client(&arguments.server_name) {
        ModelContextResult::Success { data } => data,
        ModelContextResult::Error { error } => return Err(error),
    };

    match call_model_context_tool(
        &client,
        Some(&arguments.server_name),
        &arguments.tool_name,
        &arguments.arguments,
        max_content_bytes,
    ) {
        RenderedModelContextToolResult::Success { output } => Ok(ToolReturn::Output {
            content: vec![ToolContent::Text { content: output }],
            lines: None,
        }),
        RenderedModelContextToolResult::Error { error } => Err(error),
    }
}

fn model_context_missing_tool_error(
    tool_name: &str,
    server_name: Option<&str>,
    available_tools: &[ModelContextToolSummary],
) -> String {
    let available = available_tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let server_label = server_name
        .map(|name| format!(" in MCP server \"{name}\""))
        .unwrap_or_default();

    format!("Tool \"{tool_name}\" not found{server_label}. Available tools: {available}")
}

const MODEL_CONTEXT_TOOL_DESCRIPTION: &str = "\
Interact with Model Context Protocol (MCP) servers to access external tools and resources.

MCP servers provide specialized tools like filesystem access, database queries, web scraping,
or integration with external services. Each server runs as a separate process and exposes
tools that can be called with specific arguments.";

struct ModelContextToolArguments {
    server_name: String,
    tool_name: String,
    arguments: Vec<(String, String)>,
}

fn model_context_tool_arguments(parsed: &Value) -> Result<ModelContextToolArguments, String> {
    let object = parsed
        .as_object()
        .ok_or_else(|| "mcp tool arguments must be an object".to_owned())?;
    let server_name = required_string_argument(object, "server")?;
    let tool_name = required_string_argument(object, "tool")?;
    let arguments = object
        .get("arguments")
        .map(model_context_tool_call_arguments)
        .transpose()?
        .unwrap_or_default();

    Ok(ModelContextToolArguments {
        server_name,
        tool_name,
        arguments,
    })
}

fn required_string_argument(object: &Map<String, Value>, key: &str) -> Result<String, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("mcp tool argument {key} must be a string"))
}

fn model_context_tool_call_arguments(value: &Value) -> Result<Vec<(String, String)>, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "mcp tool arguments.arguments must be an object".to_owned())?;

    object
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_owned()))
                .ok_or_else(|| format!("mcp tool arguments.arguments.{key} must be a string"))
        })
        .collect()
}

fn model_context_tool_arguments_schema() -> Value {
    json!({
        "type": "object",
        "required": ["server", "tool"],
        "properties": {
            "server": {
                "type": "string",
                "description": "Name of the MCP server to use"
            },
            "tool": {
                "type": "string",
                "description": "Name of the tool to call"
            },
            "arguments": {
                "type": "object",
                "additionalProperties": { "type": "string" }
            }
        }
    })
}
