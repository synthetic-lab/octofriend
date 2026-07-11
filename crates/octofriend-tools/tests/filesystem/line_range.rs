use octofriend_tools::fs::{line_range, validate_line_range, with_line_numbers};

#[test]
fn formats_content_with_one_based_line_numbers() {
    assert_eq!(with_line_numbers("alpha\nbeta", 3), "3: alpha\n4: beta");
}

#[test]
fn selects_default_and_limited_line_ranges_with_total_line_count() {
    let full = line_range("alpha\nbeta\ngamma", None, None);
    assert_eq!(full.total_lines, 3);
    assert_eq!(full.start_line, 1);
    assert_eq!(full.end_line, 3);
    assert_eq!(full.content, "1: alpha\n2: beta\n3: gamma");

    let selected = line_range("alpha\nbeta\ngamma", Some(2), Some(1));
    assert_eq!(selected.total_lines, 3);
    assert_eq!(selected.start_line, 2);
    assert_eq!(selected.end_line, 2);
    assert_eq!(selected.content, "2: beta");
}

#[test]
fn reports_empty_ranges_after_the_end_of_the_file() {
    let selected = line_range("alpha\nbeta", Some(5), Some(2));

    assert_eq!(selected.total_lines, 2);
    assert_eq!(selected.start_line, 5);
    assert_eq!(selected.end_line, 4);
    assert_eq!(selected.content, "");
}

#[test]
fn rejects_non_positive_line_range_arguments() {
    assert_eq!(
        validate_line_range(Some(0), None),
        Err("read offset must be a positive integer".into())
    );
    assert_eq!(
        validate_line_range(None, Some(0)),
        Err("read limit must be a positive integer".into())
    );
    assert_eq!(validate_line_range(Some(1), Some(1)), Ok(()));
}
