use env as safe_env;
use ignore::WalkBuilder;
use octofriend_models::prompts::{
    DirectoryEntry, InstructionFile, InstructionTarget, SystemPromptInput,
    render_instruction_files, system_prompt,
};
use octofriend_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const INVALID_PARAMS: i64 = -32602;
const CLAUDE_FILE_NAME: &str = "CLAUDE.md";
const AGENTS_FILE_NAME: &str = "AGENTS.md";
const AGENTS_DIRECTORY_NAME: &str = ".agents";
const MAX_DIRECTORY_CONTEXT_ENTRIES: usize = 200;
const MAX_DIRECTORY_CONTEXT_DEPTH: usize = 4;

type DirectoryEntries = Vec<DirectoryEntry>;
type InstructionFiles = Vec<InstructionFile>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemPromptParams {
    #[serde(rename = "userName")]
    user_name: String,
    #[serde(rename = "workingDirectory")]
    working_directory: Option<String>,
    #[serde(default)]
    directory_entries: Option<Vec<SystemPromptDirectoryEntryParam>>,
    #[serde(default)]
    mcp_prompt: String,
    #[serde(default)]
    instruction_prompt: Option<String>,
    #[serde(default)]
    instruction_files: Option<Vec<SystemPromptInstructionFileParam>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemPromptDirectoryEntryParam {
    entry: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemPromptInstructionFileParam {
    path: String,
    target: SystemPromptInstructionTargetParam,
    contents: String,
}

#[derive(Debug, Deserialize)]
enum SystemPromptInstructionTargetParam {
    #[serde(rename = "CLAUDE.md")]
    Claude,
    #[serde(rename = "AGENTS.md")]
    Agents,
    #[serde(rename = ".agents/AGENTS.md")]
    AgentsDirectory,
}

pub(super) fn system_prompt_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<SystemPromptParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let cwd = current_directory(params.working_directory.as_deref());
    let instruction_prompt = instruction_prompt(&params, &cwd);
    let directory_entries = params
        .directory_entries
        .map(directory_entries_from_params)
        .unwrap_or_else(|| directory_entries_from_filesystem(&cwd));

    let prompt = system_prompt(&SystemPromptInput {
        user_name: params.user_name,
        working_directory: cwd.display().to_string(),
        directory_entries,
        mcp_prompt: params.mcp_prompt,
        instruction_prompt,
    });

    create_json_rpc_success(id, json!({ "prompt": prompt }))
}

fn instruction_prompt(params: &SystemPromptParams, cwd: &Path) -> String {
    if let Some(prompt) = &params.instruction_prompt {
        return prompt.clone();
    }
    if let Some(files) = &params.instruction_files {
        return render_instruction_files(
            &params.user_name,
            &files
                .iter()
                .map(instruction_file_from_param)
                .collect::<Vec<_>>(),
        );
    }
    discovered_instruction_prompt(&params.user_name, cwd)
}

fn current_directory(explicit: Option<&str>) -> PathBuf {
    explicit
        .map(PathBuf::from)
        .unwrap_or_else(|| safe_env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn directory_entries_from_params(
    entries: Vec<SystemPromptDirectoryEntryParam>,
) -> DirectoryEntries {
    entries
        .into_iter()
        .map(|entry| DirectoryEntry {
            entry: entry.entry,
            is_directory: entry.is_directory,
        })
        .collect()
}

fn directory_entries_from_filesystem(cwd: &Path) -> DirectoryEntries {
    let mut entries = WalkBuilder::new(cwd)
        .standard_filters(true)
        .max_depth(Some(MAX_DIRECTORY_CONTEXT_DEPTH))
        .build()
        .filter_map(|entry| directory_entry_from_walk_result(cwd, entry))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.entry.cmp(&right.entry));
    entries.truncate(MAX_DIRECTORY_CONTEXT_ENTRIES);
    entries
}

fn directory_entry_from_walk_result(
    cwd: &Path,
    entry: Result<ignore::DirEntry, ignore::Error>,
) -> Option<DirectoryEntry> {
    let entry = entry.ok()?;
    let path = entry.path();
    if path == cwd {
        return None;
    }
    let relative_path = path.strip_prefix(cwd).ok()?;
    let entry_path = relative_path
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if entry_path.is_empty() {
        return None;
    }
    let is_directory = entry
        .file_type()
        .map(|file_type| file_type.is_dir())
        .unwrap_or(false);
    Some(DirectoryEntry {
        entry: entry_path,
        is_directory,
    })
}

fn instruction_file_from_param(file: &SystemPromptInstructionFileParam) -> InstructionFile {
    InstructionFile {
        path: file.path.clone(),
        target: match file.target {
            SystemPromptInstructionTargetParam::Claude => InstructionTarget::Claude,
            SystemPromptInstructionTargetParam::Agents => InstructionTarget::Agents,
            SystemPromptInstructionTargetParam::AgentsDirectory => {
                InstructionTarget::AgentsDirectory
            }
        },
        contents: file.contents.clone(),
    }
}

fn discovered_instruction_prompt(user_name: &str, cwd: &Path) -> String {
    let home = safe_env::var_os("HOME")
        .or_else(|| safe_env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let config_home = safe_env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let files = load_instruction_files(cwd, &home, &config_home);
    render_instruction_files(user_name, &files)
}

fn load_instruction_files(cwd: &Path, home: &Path, config_home: &Path) -> InstructionFiles {
    let mut directory_groups = Vec::new();
    let mut current = cwd.to_path_buf();

    while is_directory_inside_search_root(&current, home) {
        let mut group = Vec::new();
        push_instruction_file_in_directory(&mut group, &current);
        if !group.is_empty() {
            directory_groups.push(group);
        }

        let Some(parent) = current.parent() else {
            break;
        };
        if parent == current {
            break;
        }
        current = parent.to_path_buf();
    }

    let mut discovered = Vec::new();
    push_instruction_file_in_directory(&mut discovered, &home.join(".config").join("octofriend"));
    push_if_file(
        &mut discovered,
        config_home.join(AGENTS_FILE_NAME),
        InstructionTarget::Agents,
    );

    for group in directory_groups.into_iter().rev() {
        discovered.extend(group);
    }
    discovered
}

fn push_instruction_file_in_directory(files: &mut InstructionFiles, directory: &Path) {
    push_if_file(
        files,
        directory.join(AGENTS_FILE_NAME),
        InstructionTarget::Agents,
    );
    push_if_file(
        files,
        directory.join(AGENTS_DIRECTORY_NAME).join(AGENTS_FILE_NAME),
        InstructionTarget::AgentsDirectory,
    );
    push_if_file(
        files,
        directory.join(CLAUDE_FILE_NAME),
        InstructionTarget::Claude,
    );
}

fn push_if_file(files: &mut InstructionFiles, path: PathBuf, target: InstructionTarget) -> bool {
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return false;
    };
    files.push(InstructionFile {
        path: path.display().to_string(),
        target,
        contents,
    });
    true
}

fn is_directory_inside_search_root(directory: &Path, home: &Path) -> bool {
    directory != home && directory.parent().is_some()
}
