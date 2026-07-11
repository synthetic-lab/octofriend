use super::messages::{file_language, number_width, split_trimmed_line};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffLineKind {
    Context,
    Removed,
    Added,
    Blank,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRenderLine {
    pub line_number: Option<usize>,
    pub kind: DiffLineKind,
    pub leading_whitespace: String,
    pub code: String,
    pub trailing_whitespace: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRenderRow {
    pub old: DiffRenderLine,
    pub new: DiffRenderLine,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRenderModel {
    pub file_path: String,
    pub language: String,
    pub start_line: usize,
    pub line_number_width: usize,
    pub hunks: Vec<DiffRenderRow>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DiffRenderError {
    OldTextNotFound,
}

impl Display for DiffRenderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OldTextNotFound => formatter
                .write_str("diff render model error: old text is not present in file contents"),
        }
    }
}

impl Error for DiffRenderError {}

pub fn build_diff_render_model(
    file_path: impl Into<String>,
    file_contents: &str,
    old_text: &str,
    new_text: &str,
) -> Result<DiffRenderModel, DiffRenderError> {
    let file_path = file_path.into();
    let start_line =
        find_start_line(file_contents, old_text).ok_or(DiffRenderError::OldTextNotFound)?;
    let line_number_width =
        number_width((start_line + count_lines(old_text)).max(start_line + count_lines(new_text)));
    let rows = build_diff_rows(start_line, old_text, new_text);

    Ok(DiffRenderModel {
        language: file_language(&file_path),
        file_path,
        start_line,
        line_number_width,
        hunks: rows,
    })
}

fn build_diff_rows(start_line: usize, old_text: &str, new_text: &str) -> Vec<DiffRenderRow> {
    let old_lines = split_render_lines(old_text);
    let new_lines = split_render_lines(new_text);
    let prefix_len = common_prefix_len(&old_lines, &new_lines);
    let suffix_len = common_suffix_len(&old_lines[prefix_len..], &new_lines[prefix_len..]);
    let old_changed_end = old_lines.len().saturating_sub(suffix_len);
    let new_changed_end = new_lines.len().saturating_sub(suffix_len);
    let mut rows = Vec::new();
    let mut old_line_number = start_line;
    let mut new_line_number = start_line;

    for line in &old_lines[..prefix_len] {
        rows.push(DiffRenderRow {
            old: render_line(Some(old_line_number), DiffLineKind::Context, line),
            new: render_line(Some(new_line_number), DiffLineKind::Context, line),
        });
        old_line_number += 1;
        new_line_number += 1;
    }

    let old_changed = &old_lines[prefix_len..old_changed_end];
    let new_changed = &new_lines[prefix_len..new_changed_end];
    let changed_len = old_changed.len().max(new_changed.len());
    for index in 0..changed_len {
        let old = old_changed.get(index).map_or_else(blank_line, |line| {
            let rendered = render_line(Some(old_line_number), DiffLineKind::Removed, line);
            old_line_number += 1;
            rendered
        });
        let new = new_changed.get(index).map_or_else(blank_line, |line| {
            let rendered = render_line(Some(new_line_number), DiffLineKind::Added, line);
            new_line_number += 1;
            rendered
        });
        rows.push(DiffRenderRow { old, new });
    }

    for line in &old_lines[old_changed_end..] {
        rows.push(DiffRenderRow {
            old: render_line(Some(old_line_number), DiffLineKind::Context, line),
            new: render_line(Some(new_line_number), DiffLineKind::Context, line),
        });
        old_line_number += 1;
        new_line_number += 1;
    }

    rows
}

fn find_start_line(file_contents: &str, old_text: &str) -> Option<usize> {
    let index = file_contents.find(old_text)?;
    Some(
        file_contents[..index]
            .chars()
            .filter(|character| *character == '\n')
            .count()
            + 1,
    )
}

fn split_render_lines(text: &str) -> Vec<&str> {
    let mut lines = text.split('\n').collect::<Vec<_>>();
    if lines.len() > 1 && lines.last() == Some(&"") {
        lines.pop();
    }
    lines
}

fn common_prefix_len(old_lines: &[&str], new_lines: &[&str]) -> usize {
    old_lines
        .iter()
        .zip(new_lines.iter())
        .take_while(|(old, new)| old == new)
        .count()
}

fn common_suffix_len(old_lines: &[&str], new_lines: &[&str]) -> usize {
    old_lines
        .iter()
        .rev()
        .zip(new_lines.iter().rev())
        .take_while(|(old, new)| old == new)
        .count()
}

fn render_line(line_number: Option<usize>, kind: DiffLineKind, line: &str) -> DiffRenderLine {
    let trimmed = split_trimmed_line(line);
    DiffRenderLine {
        line_number,
        kind,
        leading_whitespace: trimmed.leading_whitespace,
        code: trimmed.code,
        trailing_whitespace: trimmed.trailing_whitespace,
    }
}

fn blank_line() -> DiffRenderLine {
    DiffRenderLine {
        line_number: None,
        kind: DiffLineKind::Blank,
        leading_whitespace: String::new(),
        code: String::new(),
        trailing_whitespace: String::new(),
    }
}

fn count_lines(text: &str) -> usize {
    text.split('\n').count()
}
