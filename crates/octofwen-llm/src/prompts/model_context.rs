use super::template::render_markdown_template;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContextToolSummary {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelContextServerTools {
    pub name: String,
    pub tools: Vec<ModelContextToolSummary>,
}

const MODEL_CONTEXT_PROMPT: &str = include_str!("templates/model_context.md");

pub fn format_model_context_servers_prompt(servers: &[ModelContextServerTools]) -> String {
    if servers.is_empty() {
        return String::new();
    }

    let sections = servers
        .iter()
        .map(format_model_context_server_tools)
        .collect::<Vec<_>>()
        .join("\n\n");

    render_markdown_template(MODEL_CONTEXT_PROMPT, &[("sections", &sections)])
        .trim_end_matches('\n')
        .to_owned()
}

fn format_model_context_server_tools(server: &ModelContextServerTools) -> String {
    let tools = server
        .tools
        .iter()
        .map(format_model_context_tool_summary)
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "Server: {}\n{}",
        server.name,
        if tools.is_empty() {
            "No tools available"
        } else {
            &tools
        }
    )
}

fn format_model_context_tool_summary(tool: &ModelContextToolSummary) -> String {
    match &tool.description {
        Some(description) if !description.is_empty() => format!("- {}: {}", tool.name, description),
        _ => format!("- {}", tool.name),
    }
}
