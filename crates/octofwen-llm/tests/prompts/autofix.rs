use octofwen_llm::prompts::{BrokenDiffEdit, DiffEdit, fix_edit_prompt, fix_json_prompt};

#[test]
fn fix_edit_prompt_renders_schema_names_and_compact_broken_edit_json() {
    let prompt = fix_edit_prompt(&BrokenDiffEdit {
        file: "const value = 1;".into(),
        edit: DiffEdit {
            search: "const value = 2;".into(),
            replace: "const value = 3;".into(),
        },
    });

    assert_eq!(
        prompt,
        "The following diff edit is invalid: the search string does not match perfectly with the file contents.\nYour task is to fix the search string if possible.\n\nRespond only with JSON in the following format, defined as TypeScript types:\n\n// Response if you fixed the search string:\ntype DiffApplySuccess = {\n  success: true,\n  search: string,\n};\n\n// Response if the edit is impossible to fix (search string is ambiguous or has no clear matches):\ntype DiffApplyFailure = {\n  success: false,\n};\n\nHere's the broken edit and underlying file it's being applied to:\n{\"file\":\"const value = 1;\",\"edit\":{\"search\":\"const value = 2;\",\"replace\":\"const value = 3;\"}}"
    );
}

#[test]
fn fix_json_prompt_renders_json_repair_response_schemas_and_input() {
    assert_eq!(
        fix_json_prompt("{\"name\":"),
        "The following string may be broken JSON. Fix it if possible. Respond with JSON in the following\nformat, defined as TypeScript types:\n\n// Success response:\ntype JsonFixSuccess = {\n  success: true,\n\n  // The parsed JSON\n  fixed: any,\n};\n\n// Failure response:\ntype JsonFixFailure = {\n  success: false,\n};\n\nIf it's more-or-less JSON, fix it and respond with the success response. If it's not, respond with\nthe failure response. Here's the string:\n{\"name\":"
    );
}
