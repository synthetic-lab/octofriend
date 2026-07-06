pub const FILE_OUTDATED_ERROR_MESSAGE: &str = "File has been modified since it was last read";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SearchReplaceEdit {
    pub path: String,
    pub search: String,
    pub replace: String,
}

pub fn apply_search_replace_edit(
    file: &str,
    edit: &SearchReplaceEdit,
    is_outdated: bool,
) -> Result<String, String> {
    validate_search_replace(&edit.path, file, &edit.search, is_outdated)?;
    Ok(file.replacen(&edit.search, &edit.replace, 1))
}

pub fn validate_search_replace(
    file_path: &str,
    file: &str,
    search: &str,
    is_outdated: bool,
) -> Result<(), String> {
    if file.contains(search) {
        return Ok(());
    }
    if is_outdated {
        return Err(FILE_OUTDATED_ERROR_MESSAGE.into());
    }
    Err(format!(
        "Could not find search string in file {file_path}: {search}\nThis is likely an error in your formatting. The search string must EXACTLY match, including\nwhitespace and punctuation."
    ))
}
