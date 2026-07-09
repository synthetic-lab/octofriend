use serde_json::Value;

use crate::runtime::results::ToolReturn;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolCall {
    pub tool_call_id: String,
    pub name: String,
    pub original: Value,
    pub parsed: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseResult {
    pub original: Value,
    pub parsed: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub arguments_schema: Value,
    pub parsed_schema: Value,
    pub required_subagents: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeTool {
    pub definition: ToolDefinition,
}

impl RuntimeTool {
    pub fn parse(&self, original: Value) -> ParseResult {
        ParseResult {
            parsed: original.clone(),
            original,
        }
    }

    pub fn validate(&self, call: &ToolCall) -> Result<(), String> {
        if call.name != self.definition.name {
            return Err(format!(
                "tool call name {} does not match tool definition {}",
                call.name, self.definition.name
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeclaredTool {
    definition: ToolDefinition,
}

impl DeclaredTool {
    #[must_use]
    pub fn with_parsed_schema(mut self, parsed_schema: Value) -> Self {
        self.definition.parsed_schema = parsed_schema;
        self
    }

    #[must_use]
    pub fn with_subagents(
        mut self,
        subagents: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.definition.required_subagents = subagents.into_iter().map(Into::into).collect();
        self
    }

    pub fn define(self) -> RuntimeTool {
        RuntimeTool {
            definition: self.definition,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ToolBuilder;

impl ToolBuilder {
    pub fn declare(
        self,
        name: impl Into<String>,
        description: impl Into<String>,
        arguments_schema: Value,
    ) -> DeclaredTool {
        let arguments_schema = normalize_schema(arguments_schema);
        DeclaredTool {
            definition: ToolDefinition {
                name: name.into(),
                description: description.into(),
                parsed_schema: arguments_schema.clone(),
                arguments_schema,
                required_subagents: Vec::new(),
            },
        }
    }

    #[must_use]
    pub const fn with_data<T>(self) -> Self {
        let _ = std::marker::PhantomData::<T>;
        self
    }

    #[must_use]
    pub const fn with_transport<T>(self) -> Self {
        let _ = std::marker::PhantomData::<T>;
        self
    }

    pub fn dynamic_define_tool(
        self,
        selector: impl FnOnce() -> Option<RuntimeTool>,
    ) -> Option<RuntimeTool> {
        let _ = self;
        selector()
    }
}

pub const TOOL_BUILDER: ToolBuilder = ToolBuilder;

pub fn flatten_tool_call(
    tool_call_id: impl Into<String>,
    name: impl Into<String>,
    original: Value,
    parsed: Value,
) -> ToolCall {
    ToolCall {
        tool_call_id: tool_call_id.into(),
        name: name.into(),
        original,
        parsed,
    }
}

pub fn custom_ir(data: Value) -> ToolReturn {
    ToolReturn::CustomIr { data }
}

fn normalize_schema(schema: Value) -> Value {
    schema
}
