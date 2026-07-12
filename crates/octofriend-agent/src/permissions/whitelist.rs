use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolCallPermissionPolicy {
    pub whitelist_key: String,
    pub skip_confirmation: bool,
    pub always_request_permission: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolCallPermissionRequest {
    pub name: String,
    pub arguments: Value,
    cwd: PathBuf,
}

impl ToolCallPermissionRequest {
    pub fn new(name: impl Into<String>, arguments: Value) -> Self {
        Self::with_cwd(name, arguments, std::env::current_dir().unwrap_or_default())
    }

    pub fn with_cwd(name: impl Into<String>, arguments: Value, cwd: impl Into<PathBuf>) -> Self {
        Self {
            name: name.into(),
            arguments,
            cwd: normalize_path(&cwd.into()),
        }
    }

    pub fn whitelist_key(&self) -> String {
        if let Some((group, scope)) = self.filesystem_scope() {
            return format!("{group}:{}", whitelist_scope(&scope));
        }

        match self.name.as_str() {
            "mcp" => format!(
                "mcp:{}:{}",
                self.arguments
                    .get("server")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                self.arguments
                    .get("tool")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            ),
            other => format!("{other}:*"),
        }
    }

    pub fn permission_policy(&self) -> ToolCallPermissionPolicy {
        let filesystem_target_is_in_cwd = self
            .filesystem_target()
            .is_none_or(|target| target.starts_with(&self.cwd));

        ToolCallPermissionPolicy {
            whitelist_key: self.whitelist_key(),
            skip_confirmation: skips_confirmation(&self.name) && filesystem_target_is_in_cwd,
            always_request_permission: always_requests_permission(&self.name),
        }
    }

    fn filesystem_scope(&self) -> Option<(&'static str, PathBuf)> {
        let target = self.filesystem_target()?;
        let scope = if target.starts_with(&self.cwd) {
            self.cwd.clone()
        } else {
            target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target.clone())
        };
        let group = if is_read_tool(&self.name) {
            "read"
        } else {
            "edits"
        };
        Some((group, scope))
    }

    fn filesystem_target(&self) -> Option<PathBuf> {
        let key = match self.name.as_str() {
            "read" | "create" | "rewrite" | "edit" => "filePath",
            "list" => "dirPath",
            "glob"
            | "grep"
            | "lsp-definition"
            | "lsp-references"
            | "lsp-hover"
            | "lsp-diagnostics"
            | "lsp-document-symbol"
            | "lsp-implementation"
            | "lsp-incoming-calls"
            | "lsp-outgoing-calls" => "path",
            _ => return None,
        };
        let raw = self
            .arguments
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty());
        let path = raw.map(PathBuf::from).unwrap_or_else(|| self.cwd.clone());
        let resolved = if path.is_absolute() {
            path
        } else {
            self.cwd.join(path)
        };
        Some(normalize_path(&resolved))
    }
}

fn whitelist_scope(path: &Path) -> String {
    let display = path.to_string_lossy();
    if std::path::MAIN_SEPARATOR == '/' {
        display.into_owned()
    } else {
        display.replace(std::path::MAIN_SEPARATOR, "/")
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn is_read_tool(name: &str) -> bool {
    matches!(
        name,
        "read"
            | "list"
            | "glob"
            | "grep"
            | "lsp-definition"
            | "lsp-references"
            | "lsp-hover"
            | "lsp-diagnostics"
            | "lsp-document-symbol"
            | "lsp-implementation"
            | "lsp-incoming-calls"
            | "lsp-outgoing-calls"
    )
}

fn skips_confirmation(name: &str) -> bool {
    matches!(name, "skill" | "web-search") || is_read_tool(name)
}

fn always_requests_permission(name: &str) -> bool {
    name == "shell"
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ToolWhitelist {
    keys: BTreeSet<String>,
}

impl ToolWhitelist {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, key: impl Into<String>) {
        self.keys.insert(key.into());
    }

    pub fn is_whitelisted(&self, key: &str) -> bool {
        self.keys.contains(key)
    }

    pub fn keys(&self) -> Vec<String> {
        self.keys.iter().cloned().collect()
    }
}
