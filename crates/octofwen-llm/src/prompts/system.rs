use super::template::render_markdown_template;
use serde_json::json;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectoryEntry {
    pub entry: String,
    pub is_directory: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SystemPromptInput {
    pub user_name: String,
    pub working_directory: String,
    pub directory_entries: Vec<DirectoryEntry>,
    pub mcp_prompt: String,
    pub instruction_prompt: String,
}

const SYSTEM_PROMPT: &str = include_str!("templates/system.md");

pub fn system_prompt(input: &SystemPromptInput) -> String {
    let directory_listing = input
        .directory_entries
        .iter()
        .map(directory_entry_json)
        .collect::<Vec<_>>()
        .join("\n");

    render_markdown_template(
        SYSTEM_PROMPT,
        &[
            ("user_name", &input.user_name),
            ("mcp_prompt", &input.mcp_prompt),
            ("working_directory", &input.working_directory),
            ("directory_listing", &directory_listing),
            ("instruction_prompt", &input.instruction_prompt),
        ],
    )
    .trim()
    .to_string()
}

fn directory_entry_json(entry: &DirectoryEntry) -> String {
    json!({
        "entry": entry.entry,
        "isDirectory": entry.is_directory,
    })
    .to_string()
}
