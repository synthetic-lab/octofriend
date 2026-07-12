use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use octofriend_workspace::workspace::wildcard_matches_bytes;
use serde_json::{Value, json};

use crate::skills::AgentSkill;

use crate::fs::{SearchReplaceEdit, apply_search_replace_edit, line_range, with_line_numbers};

use super::super::lsp::run_lsp;
use super::super::mcp::run_mcp;
use super::super::transport::RuntimeToolTransport;
use super::check::validate_runtime_tool_call;

pub fn run_runtime_tool_call(
    tool_name: &str,
    cwd: impl AsRef<Path>,
    tool_call_id: &str,
    tool_call: &Value,
    parsed: &Value,
) -> Result<Value, String> {
    let transport = RuntimeToolTransport::local(cwd);
    run_runtime_tool_call_with_transport(tool_name, transport, tool_call_id, tool_call, parsed)
}

pub fn run_runtime_tool_call_with_transport(
    tool_name: &str,
    transport: RuntimeToolTransport,
    tool_call_id: &str,
    tool_call: &Value,
    parsed: &Value,
) -> Result<Value, String> {
    let _ = tool_call_id;
    match tool_name {
        "shell" => run_shell(&transport, parsed),
        "glob" => run_glob(&transport, parsed),
        "grep" => run_grep(&transport, parsed),
        "fetch" => run_fetch(parsed),
        "web-search" => run_web_search(parsed),
        "skill" => run_skill(parsed),
        "mcp" => run_mcp(transport.cwd(), parsed),
        "lsp-definition"
        | "lsp-implementation"
        | "lsp-references"
        | "lsp-hover"
        | "lsp-incoming-calls"
        | "lsp-outgoing-calls"
        | "lsp-diagnostics"
        | "lsp-document-symbol" => run_lsp(transport.cwd(), tool_name, parsed),
        "list" => run_list(&transport, parsed),
        "read" => run_read(&transport, tool_call, parsed),
        "create" => run_create(&transport, tool_call, parsed),
        "rewrite" => run_rewrite(&transport, tool_call, parsed),
        "edit" => run_edit(&transport, tool_call, parsed),
        _ => Err(format!("unsupported tool run for {tool_name}")),
    }
}

fn run_shell(transport: &RuntimeToolTransport, parsed: &Value) -> Result<Value, String> {
    let cmd = required_string(parsed, "cmd")?;
    let timeout = required_u64(parsed, "timeout")?;
    let output = transport.shell(cmd, timeout)?;
    Ok(output_text(output, None))
}

fn run_skill(parsed: &Value) -> Result<Value, String> {
    let skill_name = required_string(parsed, "skillName")?;
    let user_name = required_string(parsed, "userName")?;
    let skills = parsed
        .get("skills")
        .and_then(Value::as_array)
        .ok_or_else(|| "tool argument skills must be an array".to_owned())?
        .iter()
        .map(agent_skill_from_json)
        .collect::<Result<Vec<_>, _>>()?;

    let Some(skill) = skills.iter().find(|candidate| candidate.name == skill_name) else {
        return Ok(output_text(format!("Unknown skill: {skill_name}"), None));
    };

    Ok(output_text(render_skill_output(user_name, skill), None))
}

fn agent_skill_from_json(value: &Value) -> Result<AgentSkill, String> {
    let metadata = value
        .get("metadata")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.into())))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    Ok(AgentSkill {
        name: required_string(value, "name")?.into(),
        description: required_string(value, "description")?.into(),
        license: optional_string(value, "license")?.map(Into::into),
        compatibility: optional_string(value, "compatibility")?.map(Into::into),
        metadata,
        instructions: required_string(value, "instructions")?.into(),
        path: required_string(value, "path")?.into(),
        skill_file_path: required_string(value, "skillFilePath")?.into(),
    })
}

fn render_skill_output(user_name: &str, skill: &AgentSkill) -> String {
    format!(
        "\
Skill name: {}
Skill directory: {}
Description: {}

{} has set up a skill for you to use. Skills are:

1. A SKILL.md file containing instructions for you, in a directory.
2. Optional scripts or assets stored in subdirectories of the skill's directory.

If there are scripts or assets stored in directories or subdirectories, typically they will be
referenced in the SKILL.md instructions. If there are no instructions relating to scripts or assets,
it's likely that they don't exist for this skill.

Here are the contents of the SKILL.md file stored at {}:
---
{}",
        skill.name,
        skill.path,
        skill.description,
        user_name,
        skill.skill_file_path,
        skill.instructions
    )
}

const MAX_WEB_SEARCH_RESPONSE_BYTES: usize = 64 * 1024;

fn run_web_search(parsed: &Value) -> Result<Value, String> {
    let query = required_string(parsed, "query")?;
    let search_url = required_string(parsed, "searchUrl")?;
    let search_key = required_string(parsed, "searchKey")?;
    let max_response_bytes = optional_usize(parsed, "modelContext")?
        .unwrap_or(MAX_WEB_SEARCH_RESPONSE_BYTES)
        .min(MAX_WEB_SEARCH_RESPONSE_BYTES);
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(search_url)
        .header("authorization", format!("Bearer {search_key}"))
        .header("content-type", "application/json")
        .body(json!({ "query": query }).to_string())
        .send()
        .map_err(|error| format!("Web search failed: {query}: {error}"))?;
    let body = response
        .text()
        .map_err(|error| format!("Web search failed: {query}: {error}"))?;
    if body.len() > max_response_bytes {
        return Err(format!(
            "Web search response too large: {} bytes (max: {max_response_bytes} bytes). Refine the query and try again.",
            body.len()
        ));
    }
    let json: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Web search failed: {query}: {error}"))?;
    let results = json
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Web search failed: {query}: results must be an array"))?;
    let lines = results
        .iter()
        .map(web_search_result_line)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(output_text(lines.join("\n"), None))
}

#[expect(
    clippy::option_option,
    reason = "wire output distinguishes missing fields from explicit JSON null"
)]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchResultLine<'a> {
    url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<Option<&'a str>>,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    published: Option<Option<&'a str>>,
}

fn web_search_result_line(entry: &Value) -> Result<String, String> {
    let line = WebSearchResultLine {
        url: required_string(entry, "url")?,
        title: optional_string_or_null(entry, "title")?,
        text: required_string(entry, "text")?,
        published: optional_string_or_null(entry, "published")?,
    };
    serde_json::to_string(&line).map_err(|error| format!("failed to render search result: {error}"))
}

#[expect(
    clippy::option_option,
    reason = "wire output distinguishes missing fields from explicit JSON null"
)]
fn optional_string_or_null<'a>(
    value: &'a Value,
    key: &str,
) -> Result<Option<Option<&'a str>>, String> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(Some(Some(value))),
        Some(Value::Null) => Ok(Some(None)),
        Some(_) => Err(format!("tool argument {key} must be a string")),
        None => Ok(None),
    }
}

fn run_fetch(parsed: &Value) -> Result<Value, String> {
    let url = required_string(parsed, "url")?;
    let include_markup = optional_bool(parsed, "includeMarkup")?.unwrap_or(false);
    let model_context = optional_usize(parsed, "modelContext")?;
    let response = reqwest::blocking::get(url).map_err(|error| error.to_string())?;
    let status = response.status();
    let full = response.text().map_err(|error| error.to_string())?;
    let text = if include_markup {
        full
    } else {
        normalize_html_text(
            &html2text::from_read(full.as_bytes(), 130).map_err(|error| error.to_string())?,
        )
    };

    if !status.is_success() {
        if status.as_u16() == 403 {
            return Err(format!(
                "Authorization failed: status code 403\n{text}\nThis appears to have failed authorization, ask the user for help: they may be able to read the URL and copy/paste for you."
            ));
        }
        return Err(format!("Request failed: {text}"));
    }

    if let Some(context) = model_context {
        if text.len() > context {
            return Err(format!(
                "Web content too large: {} bytes (max: {context} bytes)",
                text.len()
            ));
        }
    }

    Ok(output_text(text, None))
}

fn normalize_html_text(text: &str) -> String {
    text.lines()
        .map(|line| {
            line.strip_prefix("# ")
                .map(str::to_uppercase)
                .unwrap_or_else(|| line.into())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn run_grep(transport: &RuntimeToolTransport, parsed: &Value) -> Result<Value, String> {
    let pattern = optional_string(parsed, "pattern")?.unwrap_or("");
    let path = optional_string(parsed, "path")?;
    let case_insensitive = optional_bool(parsed, "caseInsensitive")?.unwrap_or(false);
    let context = optional_usize(parsed, "context")?;
    let max_results = optional_usize(parsed, "maxResults")?;
    let timeout = optional_u64(parsed, "timeout")?.unwrap_or(30_000);

    let mut args = vec!["-n".to_string(), "-r".to_string(), "-E".to_string()];
    if case_insensitive {
        args.push("-i".to_string());
    }
    if let Some(context) = context.filter(|context| *context > 0) {
        args.push(format!("-C{context}"));
    }
    args.push("--".to_string());
    args.push(shell_quote(pattern));
    let default_path;
    let search_path = match (path, transport) {
        (Some(path), _) => path,
        (None, RuntimeToolTransport::Local(cwd)) => {
            default_path = cwd.to_string_lossy().to_string();
            &default_path
        }
        (None, RuntimeToolTransport::Docker(_) | RuntimeToolTransport::Ssh(_)) => ".",
    };
    args.push(shell_quote(search_path));

    match transport.shell(&format!("grep {}", args.join(" ")), timeout) {
        Ok(output) => Ok(output_text(format_grep_output(&output, max_results), None)),
        Err(error) if error.starts_with("Command exited with code: 1\noutput:") => {
            Ok(output_text(String::new(), None))
        }
        Err(error) => Err(error),
    }
}

fn format_grep_output(output: &str, max_results: Option<usize>) -> String {
    let mut results = output
        .split('\n')
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if let Some(max_results) = max_results.filter(|max_results| *max_results > 0) {
        results.truncate(max_results);
    }
    results.join("\n")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn run_glob(transport: &RuntimeToolTransport, parsed: &Value) -> Result<Value, String> {
    let search_root = optional_string(parsed, "path")?.unwrap_or(".");
    if matches!(
        transport,
        RuntimeToolTransport::Docker(_) | RuntimeToolTransport::Ssh(_)
    ) {
        return run_remote_glob(transport, parsed, search_root);
    }
    let base = resolve_path(transport.cwd(), search_root);
    let include_name = optional_string(parsed, "includeName")?;
    let include_path = optional_string(parsed, "includePath")?;
    let exclude_name = optional_string(parsed, "excludeName")?;
    let exclude_path = optional_string(parsed, "excludePath")?;
    let case_insensitive = optional_bool(parsed, "caseInsensitive")?.unwrap_or(false);
    let max_depth = optional_usize(parsed, "maxDepth")?;
    let max_results = optional_usize(parsed, "maxResults")?;
    let entry_type = optional_string(parsed, "type")?.unwrap_or("f");

    let mut results = Vec::new();
    collect_glob_results(
        &base,
        &base,
        0,
        GlobOptions {
            include_name,
            include_path,
            exclude_name,
            exclude_path,
            case_insensitive,
            max_depth,
            entry_type,
            max_results,
            match_prefix: if search_root == "." {
                None
            } else {
                Some(search_root)
            },
        },
        &mut results,
    )?;
    Ok(output_text(results.join("\n"), None))
}

fn run_remote_glob(
    transport: &RuntimeToolTransport,
    parsed: &Value,
    search_root: &str,
) -> Result<Value, String> {
    let include_name = optional_string(parsed, "includeName")?;
    let include_path = optional_string(parsed, "includePath")?;
    let exclude_name = optional_string(parsed, "excludeName")?;
    let exclude_path = optional_string(parsed, "excludePath")?;
    let case_insensitive = optional_bool(parsed, "caseInsensitive")?.unwrap_or(false);
    let max_depth = optional_usize(parsed, "maxDepth")?;
    let max_results = optional_usize(parsed, "maxResults")?;
    let entry_type = optional_string(parsed, "type")?.unwrap_or("f");
    let mut command = format!("find {} -mindepth 1", shell_quote(search_root));
    if let Some(max_depth) = max_depth {
        write!(command, " -maxdepth {}", max_depth + 1)
            .map_err(|error| format!("failed to build remote glob command: {error}"))?;
    }
    command.push_str(if entry_type == "d" {
        " -type d -print | sort"
    } else {
        " -type f -print | sort"
    });
    let output = transport.shell(&command, 30_000)?;
    let mut results = Vec::new();
    for line in output.lines().filter(|line| !line.is_empty()) {
        if max_results.is_some_and(|max| results.len() >= max) {
            break;
        }
        let relative = remote_relative_path(search_root, line);
        if remote_path_has_excluded_dir(&relative) {
            continue;
        }
        let name = relative.rsplit('/').next().unwrap_or(&relative);
        let options = GlobOptions {
            include_name,
            include_path,
            exclude_name,
            exclude_path,
            case_insensitive,
            max_depth,
            entry_type,
            max_results,
            match_prefix: if search_root == "." {
                None
            } else {
                Some(search_root)
            },
        };
        if glob_entry_matches(name, &relative, options) {
            results.push(relative);
        }
    }
    Ok(output_text(
        results.join(
            "
",
        ),
        None,
    ))
}

fn remote_relative_path(search_root: &str, path: &str) -> String {
    let trimmed = path.trim_start_matches("./");
    if search_root == "." {
        return trimmed.to_string();
    }
    trimmed
        .strip_prefix(search_root.trim_start_matches("./"))
        .unwrap_or(trimmed)
        .trim_start_matches('/')
        .to_string()
}

fn remote_path_has_excluded_dir(path: &str) -> bool {
    path.split('/').any(is_excluded_dir)
}

#[derive(Clone, Copy)]
struct GlobOptions<'a> {
    include_name: Option<&'a str>,
    include_path: Option<&'a str>,
    exclude_name: Option<&'a str>,
    exclude_path: Option<&'a str>,
    case_insensitive: bool,
    max_depth: Option<usize>,
    entry_type: &'a str,
    max_results: Option<usize>,
    match_prefix: Option<&'a str>,
}

fn collect_glob_results(
    base: &Path,
    current: &Path,
    depth: usize,
    options: GlobOptions<'_>,
    results: &mut Vec<String>,
) -> Result<(), String> {
    if options.max_results.is_some_and(|max| results.len() >= max) {
        return Ok(());
    }
    if options.max_depth.is_some_and(|max| depth > max) {
        return Ok(());
    }

    let mut entries = std::fs::read_dir(current)
        .map_err(|error| format!("Could not read directory {}: {error}", current.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        if options.max_results.is_some_and(|max| results.len() >= max) {
            break;
        }
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() && is_excluded_dir(&name) {
            continue;
        }
        let relative = relative_path(base, &path);
        if file_type.is_dir() {
            if options.entry_type == "d" && glob_entry_matches(&name, &relative, options) {
                results.push(relative.clone());
            }
            collect_glob_results(base, &path, depth + 1, options, results)?;
        } else if options.entry_type != "d" && glob_entry_matches(&name, &relative, options) {
            results.push(relative);
        }
    }
    Ok(())
}

fn glob_entry_matches(name: &str, path: &str, options: GlobOptions<'_>) -> bool {
    if let Some(include_name) = options.include_name {
        if !wildcard_matches(include_name, name, options.case_insensitive) {
            return false;
        }
    }
    if let Some(include_path) = options.include_path {
        if !path_pattern_matches(include_path, path, options.match_prefix) {
            return false;
        }
    }
    if let Some(exclude_name) = options.exclude_name {
        if wildcard_matches(exclude_name, name, false) {
            return false;
        }
    }
    if let Some(exclude_path) = options.exclude_path {
        if path_pattern_matches(exclude_path, path, options.match_prefix) {
            return false;
        }
    }
    true
}

fn path_pattern_matches(pattern: &str, path: &str, match_prefix: Option<&str>) -> bool {
    if wildcard_matches(pattern, path, false) {
        return true;
    }
    let Some(prefix) = match_prefix else {
        return false;
    };
    wildcard_matches(pattern, &format!("{prefix}/{path}"), false)
}

fn relative_path(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches(std::path::MAIN_SEPARATOR)
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn is_excluded_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | ".svn"
            | ".hg"
            | ".vscode"
            | ".idea"
            | "dist"
            | "build"
            | "out"
            | ".next"
            | "target"
            | "bin"
            | "obj"
            | ".turbo"
            | ".output"
            | "__pycache__"
            | ".pytest_cache"
            | ".cache"
            | "bower_components"
            | ".pnpm-store"
            | "vendor"
            | ".npm"
            | ".sst"
            | ".webkit-cache"
            | "mypy_cache"
            | ".history"
            | ".gradle"
    )
}

fn wildcard_matches(pattern: &str, value: &str, case_insensitive: bool) -> bool {
    let pattern = if case_insensitive {
        pattern.to_ascii_lowercase()
    } else {
        pattern.to_string()
    };
    let value = if case_insensitive {
        value.to_ascii_lowercase()
    } else {
        value.to_string()
    };
    wildcard_matches_bytes(pattern.as_bytes(), value.as_bytes())
}

fn run_list(transport: &RuntimeToolTransport, parsed: &Value) -> Result<Value, String> {
    if matches!(transport, RuntimeToolTransport::Local(_)) {
        validate_runtime_tool_call("list", transport.cwd(), parsed)?;
    }
    let dir_path = optional_string(parsed, "dirPath")?.unwrap_or(".");
    let lines = transport
        .readdir(dir_path)?
        .into_iter()
        .map(|entry| json!({ "entry": entry.entry, "isDirectory": entry.is_directory }).to_string())
        .collect::<Vec<_>>();
    Ok(output_text(lines.join("\n"), None))
}

fn run_read(
    transport: &RuntimeToolTransport,
    tool_call: &Value,
    parsed: &Value,
) -> Result<Value, String> {
    let file_path = required_string(parsed, "filePath")?;
    let offset = optional_usize(parsed, "offset")?;
    let limit = optional_usize(parsed, "limit")?;
    crate::fs::validate_line_range(offset, limit)?;
    let content = transport
        .read_file(file_path)
        .map_err(|_| format!("No such file {file_path}"))?;

    if offset.is_some() || limit.is_some() {
        let range = line_range(&content, offset, limit);
        return Ok(output_text(
            format!(
                "Showing lines {}-{} of {} from {}\n{}",
                range.start_line, range.end_line, range.total_lines, file_path, range.content
            ),
            Some(range.total_lines),
        ));
    }

    Ok(custom_ir(json!({
        "role": "file-read",
        "content": with_line_numbers(&content, 1),
        "toolCall": tool_call,
        "path": file_path,
    })))
}

fn run_create(
    transport: &RuntimeToolTransport,
    tool_call: &Value,
    parsed: &Value,
) -> Result<Value, String> {
    if matches!(transport, RuntimeToolTransport::Local(_)) {
        validate_runtime_tool_call("create", transport.cwd(), parsed)?;
    }
    let file_path = required_string(parsed, "filePath")?;
    let content = required_string(parsed, "content")?;
    if transport.path_exists(file_path) {
        return Err("File already exists".into());
    }
    transport
        .write_file(file_path, content)
        .map_err(|_| format!("Failed to create file {file_path}"))?;
    Ok(file_mutate_ir(tool_call, file_path))
}

fn run_rewrite(
    transport: &RuntimeToolTransport,
    tool_call: &Value,
    parsed: &Value,
) -> Result<Value, String> {
    if matches!(transport, RuntimeToolTransport::Local(_)) {
        validate_runtime_tool_call("rewrite", transport.cwd(), parsed)?;
    }
    let file_path = required_string(parsed, "filePath")?;
    let text = required_string(parsed, "text")?;
    transport
        .read_file(file_path)
        .map_err(|_| format!("{file_path} couldn't be read"))?;
    transport
        .write_file(file_path, text)
        .map_err(|_| format!("Failed to rewrite file {file_path}"))?;
    Ok(file_mutate_ir(tool_call, file_path))
}

fn run_edit(
    transport: &RuntimeToolTransport,
    tool_call: &Value,
    parsed: &Value,
) -> Result<Value, String> {
    if matches!(transport, RuntimeToolTransport::Local(_)) {
        validate_runtime_tool_call("edit", transport.cwd(), parsed)?;
    }
    let file_path = required_string(parsed, "filePath")?;
    let search = required_string(parsed, "search")?;
    let replace = required_string(parsed, "replace")?;
    let file = transport.read_file(file_path)?;
    let replaced = apply_search_replace_edit(
        &file,
        &SearchReplaceEdit {
            path: file_path.into(),
            search: search.into(),
            replace: replace.into(),
        },
        false,
    )?;
    transport
        .write_file(file_path, &replaced)
        .map_err(|_| format!("Failed to edit file {file_path}"))?;
    Ok(file_mutate_ir(tool_call, file_path))
}

pub(in crate::runtime) fn output_text(content: String, lines: Option<usize>) -> Value {
    json!({
        "type": "output",
        "content": [{ "type": "text", "content": content }],
        "lines": lines,
    })
}

fn custom_ir(data: Value) -> Value {
    json!({ "type": "custom-ir", "data": data })
}

fn file_mutate_ir(tool_call: &Value, file_path: &str) -> Value {
    custom_ir(json!({
        "role": "file-mutate",
        "content": "",
        "toolCall": tool_call,
        "path": file_path,
    }))
}

pub(in crate::runtime) fn required_string<'a>(
    value: &'a Value,
    key: &str,
) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("tool argument {key} must be a string"))
}

fn required_u64(value: &Value, key: &str) -> Result<u64, String> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("tool argument {key} must be a number"))
}

fn optional_string<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(format!("tool argument {key} must be a string")),
        None => Ok(None),
    }
}

fn optional_u64(value: &Value, key: &str) -> Result<Option<u64>, String> {
    match value.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .map(Some)
            .ok_or_else(|| format!("tool argument {key} must be a positive integer")),
        Some(_) => Err(format!("tool argument {key} must be a positive integer")),
        None => Ok(None),
    }
}

fn optional_bool(value: &Value, key: &str) -> Result<Option<bool>, String> {
    match value.get(key) {
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(format!("tool argument {key} must be a boolean")),
        None => Ok(None),
    }
}

fn optional_usize(value: &Value, key: &str) -> Result<Option<usize>, String> {
    match value.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| format!("tool argument {key} must be a positive integer")),
        Some(_) => Err(format!("tool argument {key} must be a positive integer")),
        None => Ok(None),
    }
}

fn resolve_path(cwd: &Path, file_path: &str) -> PathBuf {
    let path = Path::new(file_path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}
