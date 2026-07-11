use octofriend_agent::rendering_model::{DiffLineKind, build_diff_render_model};

#[test]
fn diff_render_model_pairs_changed_old_and_new_lines() {
    let model = build_diff_render_model("file.ts", "one\ntwo\nthree", "two", "too")
        .expect("old text should exist in file contents");

    assert_eq!(model.file_path, "file.ts");
    assert_eq!(model.language, "ts");
    assert_eq!(model.start_line, 2);
    assert_eq!(model.line_number_width, 1);
    assert_eq!(model.hunks.len(), 1);
    assert_eq!(model.hunks[0].old.line_number, Some(2));
    assert_eq!(model.hunks[0].old.kind, DiffLineKind::Removed);
    assert_eq!(model.hunks[0].old.code, "two");
    assert_eq!(model.hunks[0].new.line_number, Some(2));
    assert_eq!(model.hunks[0].new.kind, DiffLineKind::Added);
    assert_eq!(model.hunks[0].new.code, "too");
}

#[test]
fn diff_render_model_reports_missing_old_text() {
    let error = build_diff_render_model("file.ts", "one\ntwo", "missing", "new")
        .expect_err("old text is absent");

    assert_eq!(
        error.to_string(),
        "diff render model error: old text is not present in file contents"
    );
}

#[test]
fn diff_render_model_represents_insertions_with_blank_old_side() {
    let model = build_diff_render_model("file.txt", "alpha", "alpha", "alpha\nbeta")
        .expect("old text should exist in file contents");

    assert_eq!(model.hunks.len(), 2);
    assert_eq!(model.hunks[0].old.kind, DiffLineKind::Context);
    assert_eq!(model.hunks[0].new.kind, DiffLineKind::Context);
    assert_eq!(model.hunks[1].old.line_number, None);
    assert_eq!(model.hunks[1].old.kind, DiffLineKind::Blank);
    assert_eq!(model.hunks[1].new.line_number, Some(2));
    assert_eq!(model.hunks[1].new.kind, DiffLineKind::Added);
    assert_eq!(model.hunks[1].new.code, "beta");
}

#[test]
fn diff_render_model_serializes_with_bridge_camel_case_fields() {
    let model =
        build_diff_render_model("src/lib.ts", "old", "old", "new").expect("old text should exist");

    let value = serde_json::to_value(model).expect("diff render model should serialize");

    assert_eq!(value["filePath"], "src/lib.ts");
    assert_eq!(value["startLine"], 1);
    assert_eq!(value["lineNumberWidth"], 1);
    assert_eq!(value["hunks"][0]["old"]["lineNumber"], 1);
    assert_eq!(value["hunks"][0]["old"]["kind"], "removed");
    assert_eq!(value["hunks"][0]["new"]["kind"], "added");
}
