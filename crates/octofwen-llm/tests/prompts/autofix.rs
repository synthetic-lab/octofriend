use octofwen_llm::prompts::{BrokenDiffEdit, DiffEdit, fix_edit_prompt, fix_json_prompt};

#[test]
fn fix_edit_prompt_renders_json_schema_and_compact_broken_edit_json() {
    let prompt = fix_edit_prompt(&BrokenDiffEdit {
        file: "const value = 1;".into(),
        edit: DiffEdit {
            search: "const value = 2;".into(),
            replace: "const value = 3;".into(),
        },
    });

    assert!(!prompt.contains("```"));
    assert!(!prompt.contains("typescript"));
    assert!(!prompt.contains("TypeScript"));
    assert!(prompt.contains("Respond only with JSON matching this JSON Schema:"));
    assert!(prompt.contains(r#""anyOf""#));
    assert!(prompt.contains(r#""const": true"#));
    assert!(prompt.contains(r#""search""#));
    assert!(prompt.contains(r#""additionalProperties": false"#));
    assert!(prompt.contains(r#"{"file":"const value = 1;","edit":{"search":"const value = 2;","replace":"const value = 3;"}}"#));
}

#[test]
fn fix_json_prompt_renders_json_repair_response_json_schema_and_input() {
    let prompt = fix_json_prompt("{\"name\":");
    assert!(!prompt.contains("```"));
    assert!(!prompt.contains("typescript"));
    assert!(!prompt.contains("TypeScript"));
    assert!(prompt.contains("Respond with JSON matching this JSON Schema:"));
    assert!(prompt.contains(r#""anyOf""#));
    assert!(prompt.contains(r#""fixed""#));
    assert!(prompt.contains(r#""const": false"#));
    assert!(prompt.ends_with("{\"name\":"));
}
