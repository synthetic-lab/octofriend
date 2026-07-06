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
    match tool_name {
        "edit" | "rewrite" => parse_file_mutation_arguments(cwd.as_ref(), original),
        _ => Ok(ToolArgumentParseResult {
            original: original.clone(),
            parsed: original,
        }),
    }
}

fn parse_file_mutation_arguments(
    cwd: &Path,
    original: Value,
) -> Result<ToolArgumentParseResult, String> {
    let object = original
        .as_object()
        .ok_or_else(|| "tool arguments must be an object".to_owned())?;
    let file_path = object
        .get("filePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "tool argument filePath must be a string".to_owned())?;
    let contents = std::fs::read_to_string(resolve_path(cwd, file_path))
        .map_err(|_| format!("{file_path} couldn't be read"))?;
    let mut parsed = Map::from_iter(
        object
            .iter()
            .map(|(key, value)| (key.clone(), value.clone())),
    );
    parsed.insert("originalFileContents".into(), Value::String(contents));
    Ok(ToolArgumentParseResult {
        original,
        parsed: Value::Object(parsed),
    })
}

fn resolve_path(cwd: &Path, file_path: &str) -> std::path::PathBuf {
    let path = Path::new(file_path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}
