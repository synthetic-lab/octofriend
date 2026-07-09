use std::path::Path;

use serde_json::{Map, Value};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolArgumentParseResult {
    pub original: Value,
    pub parsed: Value,
}

pub fn parse_tool_arguments(
    tool_name: &str,
    cwd: impl AsRef<Path>,
    original: Value,
) -> Result<ToolArgumentParseResult, String> {
    let _ = cwd.as_ref();
    match tool_name {
        "edit" | "rewrite" => parse_file_mutation_arguments(original),
        _ => Ok(ToolArgumentParseResult {
            original: original.clone(),
            parsed: original,
        }),
    }
}

fn parse_file_mutation_arguments(original: Value) -> Result<ToolArgumentParseResult, String> {
    let object = original
        .as_object()
        .ok_or_else(|| "tool arguments must be an object".to_owned())?;
    let mut parsed = object
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Map<_, _>>();
    parsed.remove("originalFileContents");
    let normalized = Value::Object(parsed);
    Ok(ToolArgumentParseResult {
        original: normalized.clone(),
        parsed: normalized,
    })
}
