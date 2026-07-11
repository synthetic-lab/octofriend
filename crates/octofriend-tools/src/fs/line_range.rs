#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LineRangeResult {
    pub total_lines: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
}

pub fn with_line_numbers(content: &str, start_line: usize) -> String {
    content
        .split('\n')
        .enumerate()
        .map(|(index, line)| format!("{}: {line}", start_line + index))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn validate_line_range(offset: Option<usize>, limit: Option<usize>) -> Result<(), String> {
    if offset == Some(0) {
        return Err("read offset must be a positive integer".into());
    }
    if limit == Some(0) {
        return Err("read limit must be a positive integer".into());
    }
    Ok(())
}

pub fn line_range(content: &str, offset: Option<usize>, limit: Option<usize>) -> LineRangeResult {
    let all_lines = content.split('\n').collect::<Vec<_>>();
    let start_line = offset.unwrap_or(1);
    let start_index = start_line.saturating_sub(1);
    let end_index = limit.map_or(all_lines.len(), |limit| start_index + limit);
    let selected = if start_index >= all_lines.len() {
        Vec::new()
    } else {
        all_lines[start_index..all_lines.len().min(end_index)].to_vec()
    };
    let end_line = if selected.is_empty() {
        start_line.saturating_sub(1)
    } else {
        start_line + selected.len() - 1
    };
    let content = if selected.is_empty() {
        String::new()
    } else {
        with_line_numbers(&selected.join("\n"), start_line)
    };

    LineRangeResult {
        total_lines: all_lines.len(),
        start_line,
        end_line,
        content,
    }
}
