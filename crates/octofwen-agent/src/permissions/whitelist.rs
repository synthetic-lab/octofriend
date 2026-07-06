use std::collections::BTreeSet;

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
}

impl ToolCallPermissionRequest {
    pub fn new(name: impl Into<String>, arguments: Value) -> Self {
        Self {
            name: name.into(),
            arguments,
        }
    }

    pub fn whitelist_key(&self) -> String {
        match self.name.as_str() {
            "read" | "list" => "read:*".into(),
            "create" | "rewrite" | "edit" => "edits:*".into(),
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
        ToolCallPermissionPolicy {
            whitelist_key: self.whitelist_key(),
            skip_confirmation: skips_confirmation(&self.name),
            always_request_permission: always_requests_permission(&self.name),
        }
    }
}

fn skips_confirmation(name: &str) -> bool {
    matches!(
        name,
        "read"
            | "list"
            | "skill"
            | "web-search"
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
