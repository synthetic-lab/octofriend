use octofriend_tools::fs::{
    FILE_OUTDATED_ERROR_MESSAGE, SearchReplaceEdit, apply_search_replace_edit,
    validate_search_replace,
};

#[test]
fn applies_the_first_matching_search_replace_edit() {
    let edit = SearchReplaceEdit {
        path: "src/main.rs".into(),
        search: "hello".into(),
        replace: "goodbye".into(),
    };

    assert_eq!(
        apply_search_replace_edit("hello hello", &edit, false),
        Ok("goodbye hello".into())
    );
}

#[test]
fn search_replace_validation_reports_exact_match_errors() {
    let error = validate_search_replace("src/main.rs", "hello", "missing", false)
        .expect_err("missing search should fail");

    assert!(error.contains("Could not find search string in file src/main.rs: missing"));
    assert!(error.contains("The search string must EXACTLY match"));
}

#[test]
fn search_replace_validation_prefers_outdated_file_errors() {
    assert_eq!(
        validate_search_replace("src/main.rs", "hello", "missing", true),
        Err(FILE_OUTDATED_ERROR_MESSAGE.into())
    );
}
