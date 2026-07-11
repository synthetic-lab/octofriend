use octofriend_core::errors::{OctofriendError, OctofriendResult};

pub fn num_width(num: i64) -> usize {
    num.to_string().len()
}

pub fn file_ext_language(file_path: &str) -> &str {
    file_path
        .rsplit_once('.')
        .map_or("txt", |(_, extension)| extension)
}

pub fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

pub fn extract_trim(line: &str) -> (&str, &str, &str) {
    let trimmed_start = line.trim_start();
    let leading_len = line.len() - trimmed_start.len();
    let trimmed = line.trim();
    let trailing_len = line.len() - line.trim_end().len();
    let trailing_start = line.len() - trailing_len;

    (&line[..leading_len], trimmed, &line[trailing_start..])
}

pub fn insert_at(value: &str, index: usize, insertion: &str) -> OctofriendResult<String> {
    let char_count = value.chars().count();
    if index == 0 {
        return Ok(format!("{insertion}{value}"));
    }
    if char_count == index + 1 {
        return Ok(format!("{value}{insertion}"));
    }
    if index >= char_count {
        return Err(OctofriendError::new("inserting past end of string"));
    }

    let byte_index = byte_index_for_char(value, index);
    Ok(format!(
        "{}{}{}",
        &value[..byte_index],
        insertion,
        &value[byte_index..]
    ))
}

pub fn cut_index(value: &str, index: usize) -> OctofriendResult<String> {
    let char_count = value.chars().count();
    if char_count == index + 1 {
        return Ok(value.chars().take(index).collect());
    }
    if index == 0 {
        return Ok(value.chars().skip(1).collect());
    }
    if index >= char_count {
        return Err(OctofriendError::new("cutting past end of string"));
    }

    Ok(value
        .chars()
        .enumerate()
        .filter_map(|(current_index, character)| (current_index != index).then_some(character))
        .collect())
}

fn byte_index_for_char(value: &str, char_index: usize) -> usize {
    value
        .char_indices()
        .nth(char_index)
        .map_or(value.len(), |(byte_index, _)| byte_index)
}
