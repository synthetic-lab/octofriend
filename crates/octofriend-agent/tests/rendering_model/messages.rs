use octofriend_agent::rendering_model::{build_file_render_model, file_language, split_trimmed_line};

#[test]
fn file_render_model_numbers_lines_and_preserves_trimmed_segments() {
    let model = build_file_render_model("src/main.rs", "  fn main() {  }\n\tprintln!();", Some(41));

    assert_eq!(model.file_path, "src/main.rs");
    assert_eq!(model.language, "rs");
    assert_eq!(model.start_line, 41);
    assert_eq!(model.gutter_width, 3);
    assert_eq!(model.lines.len(), 2);
    assert_eq!(model.lines[0].line_number, 41);
    assert_eq!(model.lines[0].leading_whitespace, "  ");
    assert_eq!(model.lines[0].code, "fn main() {  }");
    assert_eq!(model.lines[0].trailing_whitespace, "");
    assert_eq!(model.lines[1].line_number, 42);
    assert_eq!(model.lines[1].leading_whitespace, "\t");
    assert_eq!(model.lines[1].code, "println!();");
}

#[test]
fn file_render_model_defaults_to_first_line_and_text_language() {
    let model = build_file_render_model("README", "hello", None);

    assert_eq!(model.language, "txt");
    assert_eq!(model.start_line, 1);
    assert_eq!(model.gutter_width, 2);
    assert_eq!(model.lines[0].line_number, 1);
}

#[test]
fn file_language_uses_last_extension_or_text_fallback() {
    assert_eq!(file_language("src/lib.test.ts"), "ts");
    assert_eq!(file_language("Dockerfile"), "txt");
}

#[test]
fn split_trimmed_line_keeps_leading_and_trailing_whitespace_outside_code() {
    let segments = split_trimmed_line("\t value  ");

    assert_eq!(segments.leading_whitespace, "\t ");
    assert_eq!(segments.code, "value");
    assert_eq!(segments.trailing_whitespace, "  ");
}

#[test]
fn file_render_model_serializes_with_bridge_camel_case_fields() {
    let model = build_file_render_model("src/main.rs", "fn main() {}", Some(7));

    let value = serde_json::to_value(model).expect("file render model should serialize");

    assert_eq!(value["filePath"], "src/main.rs");
    assert_eq!(value["startLine"], 7);
    assert_eq!(value["gutterWidth"], 2);
    assert_eq!(value["lines"][0]["lineNumber"], 7);
    assert_eq!(value["lines"][0]["code"], "fn main() {}");
}
