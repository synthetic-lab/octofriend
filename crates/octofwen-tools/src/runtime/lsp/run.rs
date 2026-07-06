use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::Value;

use super::session::LspRuntimeSession;

use super::super::tool::required_string;

pub(crate) fn run_lsp(cwd: &Path, tool_name: &str, parsed: &Value) -> Result<Value, String> {
    let run_config = resolve_lsp_run_config(cwd, parsed)?;
    let mut child = Command::new(&run_config.command)
        .args(&run_config.args)
        .current_dir(&run_config.root_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("LSP server failed to start: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "LSP server has no stdin".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "LSP server has no stdout".to_owned())?;
    let mut session = LspRuntimeSession::new(stdin, stdout);
    let result = session.run_tool(
        tool_name,
        parsed,
        run_config.root_path.to_string_lossy().as_ref(),
        run_config.resolved_file_path.to_string_lossy().as_ref(),
        &run_config.file_content,
    );

    drop(session);
    let _ = child.kill();
    let _ = child.wait();
    result
}

struct LspRunConfig {
    resolved_file_path: PathBuf,
    file_content: String,
    command: String,
    args: Vec<String>,
    root_path: PathBuf,
}

#[derive(Clone)]
struct LspServerConfig {
    server_name: &'static str,
    command: Vec<String>,
    extensions: Vec<String>,
    root_candidates: Vec<String>,
}

fn resolve_lsp_run_config(cwd: &Path, parsed: &Value) -> Result<LspRunConfig, String> {
    if let Some(command) = optional_string(parsed, "serverCommand")? {
        let resolved_file_path = PathBuf::from(required_string(parsed, "resolvedFilePath")?);
        return Ok(LspRunConfig {
            resolved_file_path,
            file_content: required_string(parsed, "fileContent")?.to_owned(),
            command: command.to_owned(),
            args: optional_string_array(parsed, "serverArgs")?,
            root_path: PathBuf::from(required_string(parsed, "rootPath")?),
        });
    }

    let file_path = required_string(parsed, "filePath")?;
    let resolved_file_path = resolve_file_path(cwd, file_path);
    let file_content = std::fs::read_to_string(&resolved_file_path)
        .map_err(|error| format!("LSP file couldn't be read: {error}"))?;
    let server = detect_lsp_server(cwd, &resolved_file_path, parsed)?.ok_or_else(|| {
        "No LSP server available for this file type. Fall back to other approaches like reading files directly."
            .to_owned()
    })?;
    let root_path = find_nearest_lsp_root(cwd, &resolved_file_path, &server.root_candidates)
        .unwrap_or_else(|| cwd.to_path_buf());
    let (command, args) = split_command(server.command)?;
    Ok(LspRunConfig {
        resolved_file_path,
        file_content,
        command,
        args,
        root_path,
    })
}

fn resolve_file_path(cwd: &Path, file_path: &str) -> PathBuf {
    let path = PathBuf::from(file_path);
    let resolved = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    std::fs::canonicalize(&resolved).unwrap_or(resolved)
}

fn detect_lsp_server(
    cwd: &Path,
    resolved_file_path: &Path,
    parsed: &Value,
) -> Result<Option<LspServerConfig>, String> {
    if matches!(parsed.get("lsp"), Some(Value::Bool(false))) {
        return Ok(None);
    }
    let extension = resolved_file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}").to_ascii_lowercase())
        .unwrap_or_default();
    if extension.is_empty() {
        return Ok(None);
    }

    let mut disabled = BTreeSet::new();
    let mut configured = Vec::new();
    if let Some(lsp) = parsed.get("lsp") {
        let object = lsp
            .as_object()
            .ok_or_else(|| "lsp config must be false or an object".to_owned())?;
        for (server_name, entry) in object {
            let entry_object = entry
                .as_object()
                .ok_or_else(|| format!("lsp server config {server_name} must be an object"))?;
            if entry_object
                .get("disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                disabled.insert(server_name.to_owned());
                continue;
            }
            disabled.insert(server_name.to_owned());
            configured.push(LspServerConfig {
                server_name: Box::leak(server_name.clone().into_boxed_str()),
                command: required_config_string_array(entry, "command")?,
                extensions: required_config_string_array(entry, "extensions")?,
                root_candidates: required_config_string_array(entry, "rootCandidates")?,
            });
        }
    }

    let mut servers = recommended_lsp_servers()
        .into_iter()
        .filter(|server| !disabled.contains(server.server_name))
        .collect::<Vec<_>>();
    servers.extend(configured);

    for server in servers {
        if !server
            .extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
        {
            continue;
        }
        if !is_command_executable(
            cwd,
            server.command.first().map(String::as_str).unwrap_or(""),
        ) {
            continue;
        }
        return Ok(Some(server));
    }
    Ok(None)
}

fn recommended_lsp_servers() -> Vec<LspServerConfig> {
    vec![
        lsp_server(
            "typescript-language-server",
            &["typescript-language-server", "--stdio"],
            &[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
            &["package.json", "tsconfig.json", "jsconfig.json"],
        ),
        lsp_server(
            "gopls",
            &["gopls"],
            &[".go"],
            &["go.work", "go.mod", "go.sum"],
        ),
        lsp_server(
            "rust-analyzer",
            &["rust-analyzer"],
            &[".rs"],
            &["Cargo.toml", "Cargo.lock"],
        ),
        lsp_server(
            "bash-language-server",
            &["bash-language-server", "start"],
            &[".sh", ".bash", ".zsh", ".ksh"],
            &[],
        ),
        lsp_server(
            "lua-ls",
            &["lua-language-server"],
            &[".lua"],
            &[".luarc.json", ".luarc.jsonc", ".luacheckrc", ".stylua.toml"],
        ),
        lsp_server(
            "ruby-lsp",
            &["ruby-lsp"],
            &[".rb", ".rake", ".gemspec", ".ru"],
            &["Gemfile", "Rakefile", ".ruby-version"],
        ),
        lsp_server(
            "jdtls",
            &["jdtls"],
            &[".java"],
            &[
                "pom.xml",
                "build.gradle",
                "build.gradle.kts",
                ".classpath",
                "settings.gradle",
                "settings.gradle.kts",
            ],
        ),
        lsp_server(
            "hls",
            &["haskell-language-server-wrapper", "--lsp"],
            &[".hs", ".lhs"],
            &["stack.yaml", "cabal.project", "hie.yaml"],
        ),
        lsp_server(
            "Gleam language server",
            &["gleam", "lsp"],
            &[".gleam"],
            &["gleam.toml"],
        ),
        lsp_server(
            "ocaml-lsp",
            &["ocamllsp"],
            &[".ml", ".mli"],
            &["dune-project", "dune-workspace", ".merlin", ".ocamlformat"],
        ),
        lsp_server(
            "nixd",
            &["nixd"],
            &[".nix"],
            &["flake.nix", "default.nix", "shell.nix"],
        ),
        lsp_server(
            "clojure-lsp",
            &["clojure-lsp", "listen"],
            &[".clj", ".cljs", ".cljc", ".edn"],
            &[
                "deps.edn",
                "project.clj",
                "shadow-cljs.edn",
                "bb.edn",
                "build.boot",
            ],
        ),
        lsp_server(
            "yaml-ls",
            &["yaml-language-server", "--stdio"],
            &[".yaml", ".yml"],
            &["package.json"],
        ),
        lsp_server(
            "svelteserver",
            &["svelteserver", "--stdio"],
            &[".svelte"],
            &["svelte.config.js", "svelte.config.ts", "package.json"],
        ),
        lsp_server(
            "vue-language-server",
            &["vue-language-server", "--stdio"],
            &[".vue"],
            &[
                "vue.config.js",
                "nuxt.config.ts",
                "nuxt.config.js",
                "package.json",
            ],
        ),
        lsp_server(
            "astro",
            &["astro-ls", "--stdio"],
            &[".astro"],
            &["astro.config.mjs", "astro.config.ts", "package.json"],
        ),
        lsp_server(
            "Prisma language server",
            &["prisma", "language-server"],
            &[".prisma"],
            &["schema.prisma", "prisma/schema.prisma"],
        ),
        lsp_server(
            "intelephense",
            &["intelephense", "--stdio"],
            &[".php"],
            &["composer.json", "composer.lock", ".php-version"],
        ),
        lsp_server(
            "julials",
            &[
                "julia",
                "--startup-file=no",
                "--history-file=no",
                "-e",
                "using LanguageServer; runserver()",
            ],
            &[".jl"],
            &["Project.toml", "Manifest.toml"],
        ),
        lsp_server(
            "tinymist",
            &["tinymist", "lsp"],
            &[".typ", ".typc"],
            &["typst.toml"],
        ),
    ]
}

fn lsp_server(
    server_name: &'static str,
    command: &[&str],
    extensions: &[&str],
    root_candidates: &[&str],
) -> LspServerConfig {
    LspServerConfig {
        server_name,
        command: command.iter().map(|value| (*value).to_owned()).collect(),
        extensions: extensions.iter().map(|value| (*value).to_owned()).collect(),
        root_candidates: root_candidates
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
    }
}

fn split_command(command: Vec<String>) -> Result<(String, Vec<String>), String> {
    let mut items = command.into_iter();
    let command = items
        .next()
        .ok_or_else(|| "lsp server command must include an executable".to_owned())?;
    Ok((command, items.collect()))
}

fn find_nearest_lsp_root(
    cwd: &Path,
    resolved_file_path: &Path,
    root_candidates: &[String],
) -> Option<PathBuf> {
    if root_candidates.is_empty() {
        return Some(cwd.to_path_buf());
    }
    let mut current = resolved_file_path.parent()?;
    loop {
        if root_candidates
            .iter()
            .any(|candidate| current.join(candidate).exists())
        {
            return Some(current.to_path_buf());
        }
        if current == cwd || !current.starts_with(cwd) {
            return None;
        }
        current = current.parent()?;
    }
}

fn is_command_executable(cwd: &Path, command: &str) -> bool {
    if command.is_empty() {
        return false;
    }
    let command_path = Path::new(command);
    if command_path.is_absolute() || has_path_separator(command) {
        let path = if command_path.is_absolute() {
            command_path.to_path_buf()
        } else {
            cwd.join(command_path)
        };
        return executable_candidates(&path).any(|candidate| candidate.is_file());
    }
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|entry| {
        let path = entry.join(command);
        executable_candidates(&path).any(|candidate| candidate.is_file())
    })
}

fn has_path_separator(command: &str) -> bool {
    command.contains('/') || command.contains('\\')
}

#[cfg(windows)]
fn executable_candidates(path: &Path) -> Box<dyn Iterator<Item = PathBuf> + '_> {
    if path.extension().is_some() {
        return Box::new(std::iter::once(path.to_path_buf()));
    }
    let pathext = std::env::var_os("PATHEXT")
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_owned());
    let candidates = std::iter::once(path.to_path_buf())
        .chain(
            pathext
                .split(';')
                .filter(|extension| !extension.is_empty())
                .map(|extension| path.with_extension(extension.trim_start_matches('.'))),
        )
        .collect::<Vec<_>>();
    Box::new(candidates.into_iter())
}

#[cfg(not(windows))]
fn executable_candidates(path: &Path) -> Box<dyn Iterator<Item = PathBuf> + '_> {
    Box::new(std::iter::once(path.to_path_buf()))
}

fn required_config_string_array(value: &Value, key: &str) -> Result<Vec<String>, String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("lsp server config {key} must be an array"))?
        .iter()
        .map(|item| {
            item.as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| format!("lsp server config {key} entries must be strings"))
        })
        .collect()
}

fn optional_string_array(value: &Value, key: &str) -> Result<Vec<String>, String> {
    match value.get(key) {
        None => Ok(Vec::new()),
        Some(Value::Array(values)) => values
            .iter()
            .map(|item| {
                item.as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| format!("lsp tool argument {key} entries must be strings"))
            })
            .collect(),
        Some(_) => Err(format!("lsp tool argument {key} must be an array")),
    }
}

fn optional_string<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(format!("tool argument {key} must be a string")),
        None => Ok(None),
    }
}
