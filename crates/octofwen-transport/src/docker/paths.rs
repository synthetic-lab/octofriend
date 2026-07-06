use std::path::Path;

pub(crate) fn shell_quote_path(value: &Path) -> String {
    shell_quote(&value.to_string_lossy())
}

pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
