use octofriend_models::prompts::{
    ModelContextServerTools, ModelContextToolSummary, format_model_context_servers_prompt,
};

#[test]
fn format_model_context_servers_prompt_renders_mcp_server_tool_inventory() {
    let prompt = format_model_context_servers_prompt(&[
        ModelContextServerTools {
            name: "filesystem".into(),
            tools: vec![
                ModelContextToolSummary {
                    name: "read_file".into(),
                    description: Some("Read a file".into()),
                },
                ModelContextToolSummary {
                    name: "list_directory".into(),
                    description: None,
                },
            ],
        },
        ModelContextServerTools {
            name: "empty".into(),
            tools: vec![],
        },
    ]);

    assert_eq!(
        prompt,
        "# Model-Context-Protocol (MCP) Tools\n\nYou have access to the following MCP servers and their sub-tools. Use the mcp tool to call them,\nspecifying the server and tool name:\n\nServer: filesystem\n- read_file: Read a file\n- list_directory\n\nServer: empty\nNo tools available"
    );
}

#[test]
fn format_model_context_servers_prompt_returns_empty_prompt_without_servers() {
    assert_eq!(format_model_context_servers_prompt(&[]), "");
}
