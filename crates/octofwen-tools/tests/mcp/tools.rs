use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use octofwen_tools::mcp::{
    MODEL_CONTEXT_USER_ABORTED_ERROR_MESSAGE, ModelContextClientLifecycle,
    ModelContextClientRegistry, ModelContextServerConfig, ModelContextToolClient,
    ModelContextToolResult, ModelContextToolResultContent, ModelContextToolSummary,
    RenderedModelContextToolResult, call_model_context_tool, model_context_error_message,
    model_context_error_reason, model_context_runtime_tool, run_model_context_runtime_tool,
};
use octofwen_tools::runtime::{ToolContent, ToolReturn, flatten_tool_call};
use serde_json::json;

#[derive(Clone, Default)]
struct RecordingModelContextClient {
    tools: Vec<ModelContextToolSummary>,
    called: Rc<RefCell<Vec<(String, Vec<(String, String)>)>>>,
    result: ModelContextToolResult,
}

impl ModelContextToolClient for RecordingModelContextClient {
    fn list_tools(&self) -> Vec<ModelContextToolSummary> {
        self.tools.clone()
    }

    fn call_tool(
        &self,
        name: &str,
        arguments: &[(String, String)],
    ) -> Result<ModelContextToolResult, String> {
        self.called
            .borrow_mut()
            .push((name.to_owned(), arguments.to_vec()));
        Ok(self.result.clone())
    }
}

impl ModelContextClientLifecycle for RecordingModelContextClient {
    fn close(&self) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn formats_model_context_error_reasons_and_messages() {
    assert_eq!(MODEL_CONTEXT_USER_ABORTED_ERROR_MESSAGE, "User aborted");
    assert_eq!(
        model_context_error_reason("connection failed"),
        "connection failed"
    );
    assert_eq!(
        model_context_error_message("connection failed"),
        "MCP error: connection failed"
    );
}

#[test]
fn call_model_context_tool_lists_tools_calls_the_requested_tool_and_renders_output() {
    let client = RecordingModelContextClient {
        tools: vec![
            ModelContextToolSummary {
                name: "read_file".into(),
                description: None,
            },
            ModelContextToolSummary {
                name: "list_directory".into(),
                description: None,
            },
        ],
        result: ModelContextToolResult {
            content: vec![ModelContextToolResultContent::Text {
                text: "contents".into(),
            }],
        },
        ..RecordingModelContextClient::default()
    };

    let result = call_model_context_tool(
        &client,
        Some("filesystem"),
        "read_file",
        &[("path".into(), "README.md".into())],
        100,
    );

    assert_eq!(
        result,
        RenderedModelContextToolResult::Success {
            output: "contents".into()
        }
    );
    assert_eq!(
        client.called.take(),
        vec![(
            "read_file".into(),
            vec![("path".into(), "README.md".into())]
        )]
    );
}

#[test]
fn call_model_context_tool_reports_available_tools_when_requested_tool_is_missing() {
    let client = RecordingModelContextClient {
        tools: vec![
            ModelContextToolSummary {
                name: "read_file".into(),
                description: None,
            },
            ModelContextToolSummary {
                name: "list_directory".into(),
                description: None,
            },
        ],
        ..RecordingModelContextClient::default()
    };

    let result = call_model_context_tool(&client, Some("filesystem"), "write_file", &[], 100);

    assert_eq!(
        result,
        RenderedModelContextToolResult::Error {
            error:
                "Tool \"write_file\" not found in MCP server \"filesystem\". Available tools: read_file, list_directory"
                    .into(),
        }
    );
    assert!(client.called.borrow().is_empty());
}

#[test]
fn call_model_context_tool_wraps_client_call_errors_as_mcp_errors() {
    struct FailingClient;

    impl ModelContextToolClient for FailingClient {
        fn list_tools(&self) -> Vec<ModelContextToolSummary> {
            vec![ModelContextToolSummary {
                name: "read_file".into(),
                description: None,
            }]
        }

        fn call_tool(
            &self,
            _name: &str,
            _arguments: &[(String, String)],
        ) -> Result<ModelContextToolResult, String> {
            Err("transport failed".into())
        }
    }

    assert_eq!(
        call_model_context_tool(&FailingClient, None, "read_file", &[], 100),
        RenderedModelContextToolResult::Error {
            error: "MCP error: transport failed".into(),
        }
    );
}

#[test]
fn model_context_runtime_tool_is_absent_without_configured_mcp_servers() {
    assert!(model_context_runtime_tool(false).is_none());
}

#[test]
fn model_context_runtime_tool_declares_the_mcp_tool_contract_when_servers_are_configured() {
    let tool = model_context_runtime_tool(true).expect("mcp tool should be enabled");

    assert_eq!(tool.definition.name, "mcp");
    assert!(
        tool.definition
            .description
            .contains("Model Context Protocol")
    );
    assert_eq!(
        tool.definition.arguments_schema,
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
    );
}

#[test]
fn run_model_context_runtime_tool_gets_the_client_calls_the_requested_tool_and_returns_text_output()
{
    let client = RecordingModelContextClient {
        tools: vec![ModelContextToolSummary {
            name: "read_file".into(),
            description: Some("Read a file".into()),
        }],
        result: ModelContextToolResult {
            content: vec![ModelContextToolResultContent::Text {
                text: "file contents".into(),
            }],
        },
        ..RecordingModelContextClient::default()
    };
    let calls = client.called.clone();
    let mut servers = BTreeMap::new();
    servers.insert(
        "filesystem".into(),
        ModelContextServerConfig {
            command: "server".into(),
            args: Vec::new(),
            env: BTreeMap::new(),
        },
    );
    let mut registry =
        ModelContextClientRegistry::with_connector(servers, BTreeMap::new(), false, |_input| {
            Ok(client.clone())
        });
    let tool_call = flatten_tool_call(
        "mcp-1",
        "mcp",
        json!({
            "server": "filesystem",
            "tool": "read_file",
            "arguments": { "path": "README.md" }
        }),
        json!({
            "server": "filesystem",
            "tool": "read_file",
            "arguments": { "path": "README.md" }
        }),
    );

    let result = run_model_context_runtime_tool(&mut registry, &tool_call, 100);

    assert_eq!(
        result,
        Ok(ToolReturn::Output {
            content: vec![ToolContent::Text {
                content: "file contents".into(),
            }],
            lines: None,
        })
    );
    assert_eq!(
        calls.take(),
        vec![(
            "read_file".into(),
            vec![("path".into(), "README.md".into())]
        )]
    );
}

#[test]
fn run_model_context_runtime_tool_returns_registry_and_call_errors() {
    let mut empty_registry = ModelContextClientRegistry::with_connector(
        BTreeMap::new(),
        BTreeMap::new(),
        false,
        |_input| Ok(RecordingModelContextClient::default()),
    );
    let missing_server_call = flatten_tool_call(
        "mcp-1",
        "mcp",
        json!({ "server": "missing", "tool": "read_file" }),
        json!({ "server": "missing", "tool": "read_file" }),
    );

    assert_eq!(
        run_model_context_runtime_tool(&mut empty_registry, &missing_server_call, 100),
        Err("MCP server \"missing\" not found in config. Please add it to mcpServers.".into())
    );

    let mut servers = BTreeMap::new();
    servers.insert(
        "filesystem".into(),
        ModelContextServerConfig {
            command: "server".into(),
            args: Vec::new(),
            env: BTreeMap::new(),
        },
    );
    let mut registry =
        ModelContextClientRegistry::with_connector(servers, BTreeMap::new(), false, |_input| {
            Ok(RecordingModelContextClient {
                tools: vec![ModelContextToolSummary {
                    name: "read_file".into(),
                    description: None,
                }],
                ..RecordingModelContextClient::default()
            })
        });
    let missing_tool_call = flatten_tool_call(
        "mcp-2",
        "mcp",
        json!({ "server": "filesystem", "tool": "write_file" }),
        json!({ "server": "filesystem", "tool": "write_file" }),
    );

    assert_eq!(
        run_model_context_runtime_tool(&mut registry, &missing_tool_call, 100),
        Err("Tool \"write_file\" not found in MCP server \"filesystem\". Available tools: read_file"
            .into())
    );
}
