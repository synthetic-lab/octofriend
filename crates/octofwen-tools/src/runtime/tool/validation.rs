use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::filesystem::validate_search_replace;

pub fn validate_runtime_tool_call(
    tool_name: &str,
    cwd: impl AsRef<Path>,
    parsed: &Value,
) -> Result<(), String> {
    match tool_name {
        "list" => validate_list(cwd.as_ref(), parsed),
        "create" => validate_create(cwd.as_ref(), parsed),
        "rewrite" => validate_rewrite(cwd.as_ref(), parsed),
        "edit" => validate_edit(cwd.as_ref(), parsed),
        _ => Ok(()),
    }
}

fn validate_list(cwd: &Path, parsed: &Value) -> Result<(), String> {
    let dir_path = optional_string(parsed, "dirPath")?.unwrap_or(".");
    if resolve_path(cwd, dir_path).is_dir() {
        Ok(())
    } else {
        Err(format!("{dir_path} is not a directory"))
    }
}

fn validate_create(cwd: &Path, parsed: &Value) -> Result<(), String> {
    let file_path = required_string(parsed, "filePath")?;
    if resolve_path(cwd, file_path).exists() {
        Err("File already exists".into())
    } else {
        Ok(())
    }
}

fn validate_rewrite(cwd: &Path, parsed: &Value) -> Result<(), String> {
    let file_path = required_string(parsed, "filePath")?;
    read_file(cwd, file_path).map(|_| ())
}

fn validate_edit(cwd: &Path, parsed: &Value) -> Result<(), String> {
    let file_path = required_string(parsed, "filePath")?;
    let search = required_string(parsed, "search")?;
    let file = read_file(cwd, file_path)?;
    validate_search_replace(file_path, &file, search, false)
}

fn read_file(cwd: &Path, file_path: &str) -> Result<String, String> {
    std::fs::read_to_string(resolve_path(cwd, file_path))
        .map_err(|_| format!("{file_path} couldn't be read"))
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("tool argument {key} must be a string"))
}

fn optional_string<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(format!("tool argument {key} must be a string")),
        None => Ok(None),
    }
}

fn resolve_path(cwd: &Path, file_path: &str) -> PathBuf {
    let path = Path::new(file_path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}
