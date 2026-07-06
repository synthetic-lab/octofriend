use super::template::render_markdown_template;
use schemars::JsonSchema;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiffEdit {
    pub search: String,
    pub replace: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BrokenDiffEdit {
    pub file: String,
    pub edit: DiffEdit,
}

#[derive(serde::Serialize)]
struct BrokenDiffEditPayload<'a> {
    file: &'a str,
    edit: DiffEditPayload<'a>,
}

#[derive(serde::Serialize)]
struct DiffEditPayload<'a> {
    search: &'a str,
    replace: &'a str,
}

#[derive(JsonSchema)]
#[serde(untagged)]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
enum DiffApplyResponseSchema {
    Success(DiffApplySuccessSchema),
    Failure(DiffApplyFailureSchema),
}

#[derive(JsonSchema)]
#[serde(deny_unknown_fields)]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
struct DiffApplySuccessSchema {
    success: TrueConst,
    search: String,
}

#[derive(JsonSchema)]
#[serde(deny_unknown_fields)]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
struct DiffApplyFailureSchema {
    success: FalseConst,
}

#[derive(JsonSchema)]
#[serde(untagged)]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
enum JsonFixResponseSchema {
    Success(JsonFixSuccessSchema),
    Failure(JsonFixFailureSchema),
}

#[derive(JsonSchema)]
#[serde(deny_unknown_fields)]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
struct JsonFixSuccessSchema {
    success: TrueConst,
    fixed: Value,
}

#[derive(JsonSchema)]
#[serde(deny_unknown_fields)]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
struct JsonFixFailureSchema {
    success: FalseConst,
}

#[derive(JsonSchema)]
#[schemars(extend("const" = true))]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
struct TrueConst(bool);

#[derive(JsonSchema)]
#[schemars(extend("const" = false))]
#[expect(
    dead_code,
    reason = "schema marker type used only by schemars::schema_for"
)]
struct FalseConst(bool);

const FIX_EDIT_PROMPT: &str = include_str!("templates/fix_edit.md");
const FIX_JSON_PROMPT: &str = include_str!("templates/fix_json.md");

pub fn fix_edit_prompt(broken_edit: &BrokenDiffEdit) -> String {
    render_markdown_template(
        FIX_EDIT_PROMPT,
        &[
            (
                "diff_apply_response_schema",
                &diff_apply_response_schema_json(),
            ),
            ("broken_edit_json", &broken_diff_edit_json(broken_edit)),
        ],
    )
    .trim_end_matches('\n')
    .to_owned()
}

pub fn fix_json_prompt(input: &str) -> String {
    render_markdown_template(
        FIX_JSON_PROMPT,
        &[
            ("json_fix_response_schema", &json_fix_response_schema_json()),
            ("input", input),
        ],
    )
    .trim_end_matches('\n')
    .to_owned()
}

fn broken_diff_edit_json(broken_edit: &BrokenDiffEdit) -> String {
    let payload = BrokenDiffEditPayload {
        file: &broken_edit.file,
        edit: DiffEditPayload {
            search: &broken_edit.edit.search,
            replace: &broken_edit.edit.replace,
        },
    };
    serde_json::to_string(&payload).unwrap_or_else(|error| {
        json!({ "error": format!("failed to serialize broken edit: {error}") }).to_string()
    })
}

fn diff_apply_response_schema_json() -> String {
    json_schema_string(&schemars::schema_for!(DiffApplyResponseSchema))
}

fn json_fix_response_schema_json() -> String {
    json_schema_string(&schemars::schema_for!(JsonFixResponseSchema))
}

fn json_schema_string(schema: &impl Serialize) -> String {
    serde_json::to_string_pretty(schema).unwrap_or_else(|error| {
        json!({ "error": format!("failed to serialize JSON schema: {error}") }).to_string()
    })
}
