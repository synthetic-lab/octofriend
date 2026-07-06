use crate::runtime::ToolDefinition;
use crate::skills::{AgentSkill, skill_runtime_tool};
use serde_json::{Value, json};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct BuiltInToolDefinitionsInput {
    pub has_mcp_servers: bool,
    pub has_web_search: bool,
    pub skills: Vec<AgentSkill>,
}

pub fn built_in_tool_definitions(input: BuiltInToolDefinitionsInput) -> Vec<ToolDefinition> {
    let mut tools = vec![
        tool(
            "read",
            READ_DESCRIPTION,
            object(
                &[required_string("filePath", "Path to file to read")],
                &[
                    optional_number("offset", "1-indexed line number to start reading from"),
                    optional_number("limit", "Maximum number of lines to read"),
                ],
            ),
        ),
        tool(
            "edit",
            "Applies a search/replace edit to a file. This should be your default tool to edit existing files.",
            object(
                &[
                    required_string("filePath", "The path to the file"),
                    required_string(
                        "search",
                        "The search string to replace. Must EXACTLY match the text you intend to replace, including whitespace, punctuation, etc. Make sure to give a few lines of context above and below so you don't accidentally replace a different matching substring in the same file.",
                    ),
                    required_string("replace", "The string you want to insert into the file"),
                ],
                &[],
            ),
        ),
        tool(
            "create",
            "Creates a new file with the specified content",
            object(
                &[
                    required_string("filePath", "Path where the file should be created"),
                    required_string("content", "Content to write to the file"),
                ],
                &[],
            ),
        ),
        tool(
            "rewrite",
            REWRITE_DESCRIPTION,
            object(
                &[
                    required_string("filePath", "The path to the file"),
                    required_string(
                        "text",
                        "The replaced file contents. This will rewrite and replace the entire file",
                    ),
                ],
                &[],
            ),
        ),
        tool(
            "shell",
            SHELL_DESCRIPTION,
            object(
                &[
                    required_number(
                        "timeout",
                        "A timeout for the command, in milliseconds. Be generous. You MUST specify this.",
                    ),
                    required_string("cmd", "The command to run"),
                ],
                &[],
            ),
        ),
        tool(
            "list",
            "Lists directories. Prefer this to Unix tools like `ls`. If no dirPath is provided, lists the cwd",
            object(&[], &[optional_string("dirPath", "Path to the directory")]),
        ),
        tool(
            "glob",
            GLOB_DESCRIPTION,
            object(
                &[],
                &[
                    optional_string(
                        "path",
                        "The directory to search from. Finds files recursively within this directory. Defaults to the current working directory.",
                    ),
                    optional_string(
                        "includeName",
                        "Filename (basename) glob pattern for files to include (e.g. *file-pattern*.js). Path segments should not be part of this pattern.",
                    ),
                    optional_string(
                        "excludeName",
                        "Filename (basename) glob pattern for files to exclude (e.g. *.d.ts). Path segments should not be part of this pattern.",
                    ),
                    optional_string(
                        "includePath",
                        "File path glob pattern for files to include (e.g. */src/* for files inside src directories).",
                    ),
                    optional_string(
                        "excludePath",
                        "File path glob pattern for files to exclude (e.g. */test/* for files inside test directories).",
                    ),
                    optional_bool(
                        "caseInsensitive",
                        "Use case-insensitive matching for the filename glob pattern. Exclusion patterns are not affected by this flag and are always case-sensitive.",
                    ),
                    optional_number("maxDepth", "The max depth of directories to search"),
                    optional_number("maxResults", "Max number of results to return"),
                ],
            ),
        ),
        tool(
            "grep",
            "Searches file contents using grep. Prefer this to shelling out to `grep` directly.",
            object(
                &[],
                &[
                    optional_string(
                        "pattern",
                        "The search pattern. Internally uses grep with the -E flag (extended regex).",
                    ),
                    optional_string(
                        "path",
                        "Directory or file to search in. Defaults to the current working directory.",
                    ),
                    optional_bool("caseInsensitive", "Case-insensitive search"),
                    optional_number("context", "Number of context lines around each match"),
                    optional_number("maxResults", "Max number of results to return"),
                    optional_number("timeout", "Timeout in milliseconds (defaults to 30000)"),
                ],
            ),
        ),
        tool(
            "fetch",
            "Fetches web resources via HTTP/HTTPS. Prefer this to bash-isms like curl/wget",
            object(
                &[required_string(
                    "url",
                    "Full url to fetch, e.g. https://...",
                )],
                &[optional_bool(
                    "includeMarkup",
                    "Include the HTML markup? Defaults to false. By default or when set to false, markup will be stripped and converted to plain text. Prefer markup stripping, and only set this to true if the output is confusing: otherwise you may download a massive amount of data",
                )],
            ),
        ),
        position_lsp_tool(
            "lsp-definition",
            "Find the definition location of a symbol at the given position. Use this when you need to see where a symbol was originally defined.",
        ),
        position_lsp_tool(
            "lsp-implementation",
            "Find implementation locations, jumping past interfaces and abstract classes to the code that implements them.",
        ),
        position_lsp_tool(
            "lsp-references",
            "Find all references to a symbol at the given position.",
        ),
        position_lsp_tool(
            "lsp-hover",
            "Get type info and documentation for a symbol at the given position. Use this to see type information, function signatures, or documentation.",
        ),
        position_lsp_tool(
            "lsp-incoming-calls",
            "Find all callers of a symbol at the given position.",
        ),
        position_lsp_tool(
            "lsp-outgoing-calls",
            "Find all callees of a symbol at the given position.",
        ),
        file_lsp_tool(
            "lsp-diagnostics",
            "Get errors and warnings for a file from the language server.",
        ),
        file_lsp_tool(
            "lsp-document-symbol",
            "List all symbols (functions, classes, variables, etc.) in a file.",
        ),
    ];
    if input.has_web_search {
        tools.push(tool(
            "web-search",
            WEB_SEARCH_DESCRIPTION,
            object(&[required_string("query", "The search query")], &[]),
        ));
    }
    if let Some(skill_tool) = skill_runtime_tool(&input.skills) {
        tools.push(skill_tool.definition);
    }
    if input.has_mcp_servers {
        tools.push(tool(
            "mcp",
            MCP_DESCRIPTION,
            object(
                &[
                    required_string("server", "Name of the MCP server to use"),
                    required_string("tool", "Name of the tool to call"),
                ],
                &[optional_string_map("arguments")],
            ),
        ));
    }
    tools
}

const READ_DESCRIPTION: &str = "Reads file contents as UTF-8, or loads supported image files (PNG, JPEG, etc.) for visual inspection. Prefer this to Unix tools like `cat`. Text output is prefixed with line numbers in the form `N: content` so you can refer to exact positions; the line-number prefix is NOT part of the file and must not be included when constructing edit/search strings. Prefer full reads of files unless they're very large (5k+ lines). It's useful for you to have more context, and you'll waste time chunking when reading small files with offsets. Avoid using offset or limit unless the file is huge. You MUST perform a full read of a file before editing it.";
const REWRITE_DESCRIPTION: &str = "Rewrites the entire file. If you need to rewrite large chunks of the file, or are struggling to make a diff edit work, use this as a last resort. Prefer other edit types unless you are struggling (have failed multiple times in a row). This overwrites the ENTIRE file, so make sure to write everything you intend to overwrite.";
const SHELL_DESCRIPTION: &str = "Runs a shell command in the cwd using the platform shell (/bin/sh-compatible shell on Unix, cmd.exe on Windows). The shell command is run as a subshell, not connected to a PTY, so don't run interactive commands: only run commands that will work headless.";
const GLOB_DESCRIPTION: &str = "Finds files on the filesystem, using a safe subset of Unix find syntax. Prefer this to shelling out to find. Keep glob terms scoped and specific.";
const WEB_SEARCH_DESCRIPTION: &str = "Searches the web. Use this to find information you're not sure about, to look up documentation, or to find data that was created after your training knowledge date cutoff.";
const MCP_DESCRIPTION: &str = "Interact with Model Context Protocol (MCP) servers to access external tools and resources. MCP servers provide specialized tools like filesystem access, database queries, web scraping, or integration with external services.";

fn position_lsp_tool(name: &str, description: &str) -> ToolDefinition {
    tool(
        name,
        description,
        object(
            &[
                required_string("filePath", "Path to the file to query"),
                required_number("line", "1-indexed line number"),
                required_number("character", "1-indexed column number"),
            ],
            &[],
        ),
    )
}

fn file_lsp_tool(name: &str, description: &str) -> ToolDefinition {
    tool(
        name,
        description,
        object(
            &[required_string("filePath", "Path to the file to query")],
            &[],
        ),
    )
}

fn tool(name: &str, description: &str, arguments_schema: Value) -> ToolDefinition {
    ToolDefinition {
        name: name.to_owned(),
        description: description.to_owned(),
        parsed_schema: arguments_schema.clone(),
        arguments_schema,
        required_subagents: Vec::new(),
    }
}

fn object(required: &[(&str, Value)], optional: &[(&str, Value)]) -> Value {
    let mut properties = serde_json::Map::new();
    let mut required_keys = Vec::new();
    for (key, schema) in required {
        properties.insert((*key).to_owned(), schema.clone());
        required_keys.push(json!(key));
    }
    for (key, schema) in optional {
        properties.insert((*key).to_owned(), schema.clone());
    }
    json!({ "type": "object", "required": required_keys, "properties": properties })
}

fn required_string(key: &'static str, description: &str) -> (&'static str, Value) {
    (key, json!({ "type": "string", "description": description }))
}

fn required_number(key: &'static str, description: &str) -> (&'static str, Value) {
    (key, json!({ "type": "number", "description": description }))
}

fn optional_string(key: &'static str, description: &str) -> (&'static str, Value) {
    required_string(key, description)
}

fn optional_number(key: &'static str, description: &str) -> (&'static str, Value) {
    required_number(key, description)
}

fn optional_bool(key: &'static str, description: &str) -> (&'static str, Value) {
    (
        key,
        json!({ "type": "boolean", "description": description }),
    )
}

fn optional_string_map(key: &'static str) -> (&'static str, Value) {
    (
        key,
        json!({ "type": "object", "additionalProperties": { "type": "string" } }),
    )
}
