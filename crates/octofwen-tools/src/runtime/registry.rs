use std::collections::BTreeMap;

use crate::runtime::builder::{RuntimeTool, ToolCall};
use crate::runtime::validation::validate_tool_arguments;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ToolRegistry {
    tools: BTreeMap<String, RuntimeTool>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, tool: RuntimeTool) -> Option<RuntimeTool> {
        self.tools.insert(tool.definition.name.clone(), tool)
    }

    pub fn get(&self, name: &str) -> Option<&RuntimeTool> {
        self.tools.get(name)
    }

    pub fn validate_call(&self, call: &ToolCall) -> Result<(), String> {
        let Some(tool) = self.get(&call.name) else {
            return Err(format!("unknown tool {}", call.name));
        };
        tool.validate(call)?;
        validate_tool_arguments(&tool.definition, &call.parsed)
    }

    pub fn names(&self) -> Vec<&str> {
        self.tools.keys().map(String::as_str).collect()
    }
}
