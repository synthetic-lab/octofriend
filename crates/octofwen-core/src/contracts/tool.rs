use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ids::ToolCallId;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDeclaration {
    pub name: String,
    pub description: String,
    pub schema: ToolSchemaReference,
    pub permission: ToolPermission,
}

impl ToolDeclaration {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        schema: ToolSchemaReference,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            schema,
            permission: ToolPermission::default(),
        }
    }

    pub fn with_permission(mut self, permission: ToolPermission) -> Self {
        self.permission = permission;
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolSchemaReference {
    Inline(Value),
    Ref(String),
}

impl ToolSchemaReference {
    pub fn inline(schema: Value) -> Self {
        Self::Inline(schema)
    }

    pub fn reference(reference: impl Into<String>) -> Self {
        Self::Ref(reference.into())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermission {
    pub mode: ToolPermissionMode,
    pub reason: Option<String>,
}

impl ToolPermission {
    pub fn new(mode: ToolPermissionMode) -> Self {
        Self { mode, reason: None }
    }

    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolPermissionMode {
    #[default]
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedToolArguments {
    pub original: Value,
    pub parsed: Value,
}

impl ParsedToolArguments {
    pub fn new(original: Value, parsed: Value) -> Self {
        Self { original, parsed }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEnvelope {
    pub id: ToolCallId,
    pub name: String,
    pub arguments: ParsedToolArguments,
}

impl ToolCallEnvelope {
    pub fn new(id: ToolCallId, name: impl Into<String>, arguments: ParsedToolArguments) -> Self {
        Self {
            id,
            name: name.into(),
            arguments,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultEnvelope {
    pub id: ToolCallId,
    pub ok: bool,
    pub value: Value,
}

impl ToolResultEnvelope {
    pub fn ok(id: ToolCallId, value: Value) -> Self {
        Self {
            id,
            ok: true,
            value,
        }
    }

    pub fn error(id: ToolCallId, value: Value) -> Self {
        Self {
            id,
            ok: false,
            value,
        }
    }
}
