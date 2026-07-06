use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimmedLine {
    pub leading_whitespace: String,
    pub code: String,
    pub trailing_whitespace: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRenderLine {
    pub line_number: usize,
    pub leading_whitespace: String,
    pub code: String,
    pub trailing_whitespace: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRenderModel {
    pub file_path: String,
    pub language: String,
    pub start_line: usize,
    pub gutter_width: usize,
    pub lines: Vec<FileRenderLine>,
}

pub fn build_file_render_model(
    file_path: impl Into<String>,
    contents: impl AsRef<str>,
    start_line: Option<usize>,
) -> FileRenderModel {
    let file_path = file_path.into();
    let contents = contents.as_ref();
    let start_line = start_line.unwrap_or(1);
    let line_count = contents.split('\n').count();
    let max_line = line_count + start_line;
    let gutter_width = number_width(max_line) + 1;
    let lines = contents
        .split('\n')
        .enumerate()
        .map(|(index, line)| {
            let trimmed = split_trimmed_line(line);
            FileRenderLine {
                line_number: start_line + index,
                leading_whitespace: trimmed.leading_whitespace,
                code: trimmed.code,
                trailing_whitespace: trimmed.trailing_whitespace,
            }
        })
        .collect();

    FileRenderModel {
        language: file_language(&file_path),
        file_path,
        start_line,
        gutter_width,
        lines,
    }
}

pub fn file_language(file_path: &str) -> String {
    file_path
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| !extension.is_empty())
        .unwrap_or("txt")
        .to_owned()
}

pub fn split_trimmed_line(line: &str) -> TrimmedLine {
    let leading_end = line
        .char_indices()
        .find_map(|(index, character)| (!character.is_whitespace()).then_some(index))
        .unwrap_or(line.len());
    let trailing_start = line
        .char_indices()
        .rev()
        .find_map(|(index, character)| {
            (!character.is_whitespace()).then_some(index + character.len_utf8())
        })
        .unwrap_or(0);

    let code_start = leading_end.min(line.len());
    let code_end = trailing_start.max(code_start).min(line.len());

    TrimmedLine {
        leading_whitespace: line[..code_start].to_owned(),
        code: line[code_start..code_end].to_owned(),
        trailing_whitespace: line[code_end..].to_owned(),
    }
}

pub(crate) fn number_width(number: usize) -> usize {
    number.to_string().len()
}
