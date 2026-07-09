use octofwen_text::{
    count_lines, cut_index, estimate_tokens, extract_trim, file_ext_language, insert_at, num_width,
    wrap_text_with_mapping,
};

#[test]
fn counts_lines_with_legacy_newline_split_semantics() {
    assert_eq!(count_lines("one\ntwo\nthree"), 3);
    assert_eq!(count_lines(""), 1);
    assert_eq!(count_lines("one\n"), 2);
}

#[test]
fn formats_small_string_helper_results() {
    assert_eq!(num_width(12_345), 5);
    assert_eq!(file_ext_language("src/app.test.tsx"), "tsx");
    assert_eq!(file_ext_language("README"), "txt");
    assert_eq!(extract_trim("  hello world\t"), ("  ", "hello world", "\t"));
}

#[test]
fn estimates_text_tokens_with_legacy_four_character_heuristic() {
    assert_eq!(estimate_tokens(""), 0);
    assert_eq!(estimate_tokens("a"), 1);
    assert_eq!(estimate_tokens("abcd"), 1);
    assert_eq!(estimate_tokens("abcde"), 2);
}

#[test]
fn inserts_and_cuts_strings_with_legacy_boundary_semantics() {
    assert_eq!(insert_at("abc", 0, "X").as_deref(), Ok("Xabc"));
    assert_eq!(insert_at("abc", 1, "X").as_deref(), Ok("aXbc"));
    assert_eq!(insert_at("abc", 2, "X").as_deref(), Ok("abcX"));
    assert_eq!(
        insert_at("abc", 3, "X").map_err(|error| error.message),
        Err("inserting past end of string".into())
    );

    assert_eq!(cut_index("abc", 0).as_deref(), Ok("bc"));
    assert_eq!(cut_index("abc", 1).as_deref(), Ok("ac"));
    assert_eq!(cut_index("abc", 2).as_deref(), Ok("ab"));
    assert_eq!(
        cut_index("abc", 3).map_err(|error| error.message),
        Err("cutting past end of string".into())
    );
}

#[test]
fn wraps_text_at_word_boundaries_and_maps_inserted_newlines() {
    let result = wrap_text_with_mapping("hello world", 8, None);

    assert_eq!(result.wrapped, "hello \nworld");
    assert_eq!(result.wrapped_to_original[6], -1);
    assert_eq!(result.original_to_wrapped[6], 7);
    assert_eq!(result.wrapped_to_original[result.wrapped.len()], 11);
}

#[test]
fn preserves_existing_newlines_and_switches_from_first_line_width() {
    let result = wrap_text_with_mapping("abc def\nghi", 6, Some(4));

    assert_eq!(result.wrapped, "abc\n def\nghi");
    assert_eq!(result.wrapped_to_original[3], -1);
    assert_eq!(result.wrapped_to_original[7], 6);
}
