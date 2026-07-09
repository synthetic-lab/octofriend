use crate::split::{split_into_words, split_lines};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WrapResult {
    pub wrapped: String,
    pub original_to_wrapped: Vec<usize>,
    pub wrapped_to_original: Vec<isize>,
}

fn usize_to_isize(value: usize) -> isize {
    isize::try_from(value).unwrap_or(isize::MAX)
}

struct WrapState<'a> {
    width: usize,
    effective_width: usize,
    past_first_line: bool,
    original_to_wrapped: Vec<usize>,
    wrapped_to_original: Vec<isize>,
    wrapped: String,
    wrapped_pos: usize,
    original_pos: usize,
    paragraphs: Vec<&'a str>,
}

pub fn wrap_text_with_mapping(
    text: &str,
    width: usize,
    first_line_width: Option<usize>,
) -> WrapResult {
    let text_len = text.chars().count();
    if width == 0 {
        let mapping = (0..=text_len).collect::<Vec<_>>();
        return WrapResult {
            wrapped: text.to_owned(),
            original_to_wrapped: mapping.clone(),
            wrapped_to_original: mapping.into_iter().map(usize_to_isize).collect(),
        };
    }

    let mut state = WrapState {
        width,
        effective_width: first_line_width.unwrap_or(width),
        past_first_line: false,
        original_to_wrapped: Vec::new(),
        wrapped_to_original: Vec::new(),
        wrapped: String::new(),
        wrapped_pos: 0,
        original_pos: 0,
        paragraphs: split_lines(text),
    };

    for paragraph_index in 0..state.paragraphs.len() {
        append_wrapped_paragraph(&mut state, paragraph_index);
        if paragraph_index < state.paragraphs.len() - 1 {
            append_original_newline(&mut state);
        }
    }

    set_usize(
        &mut state.original_to_wrapped,
        state.original_pos,
        state.wrapped_pos,
    );
    set_isize(
        &mut state.wrapped_to_original,
        state.wrapped_pos,
        usize_to_isize(state.original_pos),
    );

    WrapResult {
        wrapped: state.wrapped,
        original_to_wrapped: state.original_to_wrapped,
        wrapped_to_original: state.wrapped_to_original,
    }
}

fn append_wrapped_paragraph(state: &mut WrapState<'_>, paragraph_index: usize) {
    let paragraph = state.paragraphs[paragraph_index];
    if paragraph.is_empty() {
        set_usize(
            &mut state.original_to_wrapped,
            state.original_pos,
            state.wrapped_pos,
        );
        return;
    }

    let mut line_width = 0;
    let mut line_start = true;
    for word in split_into_words(paragraph) {
        let result = append_wrapped_word(state, &word, line_width, line_start);
        line_width = result.0;
        line_start = result.1;
    }
}

fn append_wrapped_word(
    state: &mut WrapState<'_>,
    word: &str,
    line_width: usize,
    line_start: bool,
) -> (usize, bool) {
    let word_width = UnicodeWidthStr::width(word);
    let mut current_line_width = line_width;
    let mut current_line_start = line_start;

    if !current_line_start && current_line_width + word_width >= state.effective_width {
        append_soft_newline(state);
        current_line_width = 0;
        current_line_start = true;
    }

    if word_width >= state.effective_width {
        return append_long_word(state, word, current_line_width, current_line_start);
    }

    for character in word.chars() {
        append_original_char(state, character);
    }

    (current_line_width + word_width, false)
}

fn append_long_word(
    state: &mut WrapState<'_>,
    word: &str,
    line_width: usize,
    line_start: bool,
) -> (usize, bool) {
    let mut current_line_width = line_width;
    let mut current_line_start = line_start;

    for character in word.chars() {
        let character_width = character.width().unwrap_or(0);
        if !current_line_start && current_line_width + character_width >= state.effective_width {
            append_soft_newline(state);
            current_line_width = 0;
        }

        append_original_char(state, character);
        current_line_width += character_width;
        current_line_start = false;
    }

    (current_line_width, current_line_start)
}

fn append_original_newline(state: &mut WrapState<'_>) {
    set_usize(
        &mut state.original_to_wrapped,
        state.original_pos,
        state.wrapped_pos,
    );
    set_isize(
        &mut state.wrapped_to_original,
        state.wrapped_pos,
        usize_to_isize(state.original_pos),
    );
    state.wrapped.push('\n');
    state.wrapped_pos += 1;
    state.original_pos += 1;
    switch_to_full_width(state);
}

fn append_soft_newline(state: &mut WrapState<'_>) {
    state.wrapped.push('\n');
    set_isize(&mut state.wrapped_to_original, state.wrapped_pos, -1);
    state.wrapped_pos += 1;
    switch_to_full_width(state);
}

fn append_original_char(state: &mut WrapState<'_>, character: char) {
    set_usize(
        &mut state.original_to_wrapped,
        state.original_pos,
        state.wrapped_pos,
    );
    set_isize(
        &mut state.wrapped_to_original,
        state.wrapped_pos,
        usize_to_isize(state.original_pos),
    );
    state.wrapped.push(character);
    state.wrapped_pos += 1;
    state.original_pos += 1;
}

fn switch_to_full_width(state: &mut WrapState<'_>) {
    if state.past_first_line {
        return;
    }
    state.past_first_line = true;
    state.effective_width = state.width;
}

fn set_usize(values: &mut Vec<usize>, index: usize, value: usize) {
    if index >= values.len() {
        values.resize(index + 1, 0);
    }
    values[index] = value;
}

fn set_isize(values: &mut Vec<isize>, index: usize, value: isize) {
    if index >= values.len() {
        values.resize(index + 1, 0);
    }
    values[index] = value;
}
