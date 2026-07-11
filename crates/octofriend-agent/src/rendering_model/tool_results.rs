use super::{DiffRenderModel, FileRenderModel, build_diff_render_model, build_file_render_model};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolRenderKind {
    ReadFile,
    ListFiles,
    Shell,
    EditFile,
    CreateFile,
    RewriteFile,
    ModelContext,
    Fetch,
    WebSearch,
    Skill,
    Glob,
    Grep,
    LanguageServer,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRenderDetail {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRenderModel {
    pub kind: ToolRenderKind,
    pub title: String,
    pub subject: Option<String>,
    pub details: Vec<ToolRenderDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_preview: Option<FileRenderModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_preview: Option<DiffRenderModel>,
}

pub fn build_tool_call_render_model(name: &str, arguments: Value) -> ToolRenderModel {
    match name {
        "read" => simple_subject(
            ToolRenderKind::ReadFile,
            "read",
            string_field(&arguments, "filePath"),
        ),
        "list" => simple_subject(
            ToolRenderKind::ListFiles,
            "list",
            string_field(&arguments, "dirPath"),
        ),
        "shell" => ToolRenderModel {
            kind: ToolRenderKind::Shell,
            title: "shell".into(),
            subject: string_field(&arguments, "cmd"),
            details: optional_detail("timeout", value_field(&arguments, "timeout")),
            file_preview: None,
            diff_preview: None,
        },
        "edit" => edit_render_model(arguments),
        "create" => create_render_model(arguments),
        "rewrite" => rewrite_render_model(arguments),
        "mcp" => mcp_render_model(arguments),
        "fetch" => simple_subject(
            ToolRenderKind::Fetch,
            "fetch",
            string_field(&arguments, "url"),
        ),
        "web-search" => ToolRenderModel {
            kind: ToolRenderKind::WebSearch,
            title: "Octo searched the web".into(),
            subject: None,
            details: Vec::new(),
            file_preview: None,
            diff_preview: None,
        },
        "skill" => ToolRenderModel {
            kind: ToolRenderKind::Skill,
            title: "Octo read the skill".into(),
            subject: string_field(&arguments, "skillName"),
            details: Vec::new(),
            file_preview: None,
            diff_preview: None,
        },
        "glob" => glob_render_model(arguments),
        "grep" => grep_render_model(arguments),
        "lsp-definition"
        | "lsp-references"
        | "lsp-hover"
        | "lsp-diagnostics"
        | "lsp-document-symbol"
        | "lsp-implementation"
        | "lsp-incoming-calls"
        | "lsp-outgoing-calls" => ToolRenderModel {
            kind: ToolRenderKind::LanguageServer,
            title: name.into(),
            subject: string_field(&arguments, "filePath"),
            details: Vec::new(),
            file_preview: None,
            diff_preview: None,
        },
        _ => ToolRenderModel {
            kind: ToolRenderKind::Unknown,
            title: name.into(),
            subject: None,
            details: Vec::new(),
            file_preview: None,
            diff_preview: None,
        },
    }
}

fn simple_subject(kind: ToolRenderKind, title: &str, subject: Option<String>) -> ToolRenderModel {
    ToolRenderModel {
        kind,
        title: title.into(),
        subject,
        details: Vec::new(),
        file_preview: None,
        diff_preview: None,
    }
}

fn create_render_model(arguments: Value) -> ToolRenderModel {
    let file_path = string_field(&arguments, "filePath");
    let content = string_field(&arguments, "content");
    let file_preview = file_path
        .as_deref()
        .zip(content.as_deref())
        .map(|(path, content)| build_file_render_model(path, content, None));

    ToolRenderModel {
        kind: ToolRenderKind::CreateFile,
        title: "Octo wants to create".into(),
        subject: file_path,
        details: Vec::new(),
        file_preview,
        diff_preview: None,
    }
}

fn edit_render_model(arguments: Value) -> ToolRenderModel {
    let file_path = string_field(&arguments, "filePath");
    let search = string_field(&arguments, "search");
    let replace = string_field(&arguments, "replace");
    let original_file_contents = string_field(&arguments, "originalFileContents");
    let diff_preview = file_path
        .as_deref()
        .zip(search.as_deref())
        .zip(replace.as_deref())
        .zip(original_file_contents.as_deref())
        .and_then(|(((path, search), replace), original)| {
            build_diff_render_model(path, original, search, replace).ok()
        });

    ToolRenderModel {
        kind: ToolRenderKind::EditFile,
        title: "Edit".into(),
        subject: file_path,
        details: Vec::new(),
        file_preview: None,
        diff_preview,
    }
}

fn rewrite_render_model(arguments: Value) -> ToolRenderModel {
    let file_path = string_field(&arguments, "filePath");
    let text = string_field(&arguments, "text");
    let original_file_contents = string_field(&arguments, "originalFileContents");
    let diff_preview = file_path
        .as_deref()
        .zip(text.as_deref())
        .zip(original_file_contents.as_deref())
        .and_then(|((path, text), original)| {
            build_diff_render_model(path, original, original, text).ok()
        });

    ToolRenderModel {
        kind: ToolRenderKind::RewriteFile,
        title: "Octo wants to rewrite the file".into(),
        subject: file_path,
        details: Vec::new(),
        file_preview: None,
        diff_preview,
    }
}

fn mcp_render_model(arguments: Value) -> ToolRenderModel {
    let server = string_field(&arguments, "server");
    let tool = string_field(&arguments, "tool");
    let subject = server
        .as_deref()
        .zip(tool.as_deref())
        .map(|(server, tool)| format!("Server: {server}, Tool: {tool}"));

    ToolRenderModel {
        kind: ToolRenderKind::ModelContext,
        title: "mcp".into(),
        subject,
        details: optional_detail("Arguments", value_field(&arguments, "arguments")),
        file_preview: None,
        diff_preview: None,
    }
}

fn glob_render_model(arguments: Value) -> ToolRenderModel {
    ToolRenderModel {
        kind: ToolRenderKind::Glob,
        title: "Octo searched for files using a glob pattern".into(),
        subject: None,
        details: [
            ("Path", "path"),
            ("Filename pattern", "includeName"),
            ("Path pattern", "includePath"),
            ("Max depth", "maxDepth"),
        ]
        .into_iter()
        .flat_map(|(label, field)| optional_detail(label, value_field(&arguments, field)))
        .collect(),
        file_preview: None,
        diff_preview: None,
    }
}

fn grep_render_model(arguments: Value) -> ToolRenderModel {
    ToolRenderModel {
        kind: ToolRenderKind::Grep,
        title: "Octo searched file contents".into(),
        subject: None,
        details: [
            ("Pattern", "pattern"),
            ("Path", "path"),
            ("Case insensitive", "caseInsensitive"),
            ("Context lines", "context"),
            ("Max results", "maxResults"),
            ("Timeout", "timeout"),
        ]
        .into_iter()
        .flat_map(|(label, field)| optional_detail(label, value_field(&arguments, field)))
        .collect(),
        file_preview: None,
        diff_preview: None,
    }
}

fn string_field(arguments: &Value, field: &str) -> Option<String> {
    arguments
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn value_field(arguments: &Value, field: &str) -> Option<String> {
    arguments.get(field).map(|value| match value {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    })
}

fn optional_detail(label: &str, value: Option<String>) -> Vec<ToolRenderDetail> {
    value
        .map(|value| {
            vec![ToolRenderDetail {
                label: label.into(),
                value,
            }]
        })
        .unwrap_or_default()
}
