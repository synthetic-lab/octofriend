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

pub fn fix_edit_prompt(broken_edit: &BrokenDiffEdit) -> String {
    format!(
        "The following diff edit is invalid: the search string does not match perfectly with the file contents.\n\
Your task is to fix the search string if possible.\n\n\
Respond only with JSON in the following format, defined as TypeScript types:\n\n\
// Response if you fixed the search string:\n\
type DiffApplySuccess = {{\n  success: true,\n  search: string,\n}};\n\n\
// Response if the edit is impossible to fix (search string is ambiguous or has no clear matches):\n\
type DiffApplyFailure = {{\n  success: false,\n}};\n\n\
Here's the broken edit and underlying file it's being applied to:\n{}",
        broken_diff_edit_json(broken_edit)
    )
}

pub fn fix_json_prompt(input: &str) -> String {
    format!(
        "The following string may be broken JSON. Fix it if possible. Respond with JSON in the following\n\
format, defined as TypeScript types:\n\n\
// Success response:\n\
type JsonFixSuccess = {{\n  success: true,\n\n  // The parsed JSON\n  fixed: any,\n}};\n\n\
// Failure response:\n\
type JsonFixFailure = {{\n  success: false,\n}};\n\n\
If it's more-or-less JSON, fix it and respond with the success response. If it's not, respond with\n\
the failure response. Here's the string:\n{}",
        input
    )
}

fn broken_diff_edit_json(broken_edit: &BrokenDiffEdit) -> String {
    format!(
        "{{\"file\":{},\"edit\":{{\"search\":{},\"replace\":{}}}}}",
        json_string(&broken_edit.file),
        json_string(&broken_edit.edit.search),
        json_string(&broken_edit.edit.replace)
    )
}

fn json_string(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() + 2);
    encoded.push('"');
    for ch in value.chars() {
        match ch {
            '"' => encoded.push_str("\\\""),
            '\\' => encoded.push_str("\\\\"),
            '\u{08}' => encoded.push_str("\\b"),
            '\u{0c}' => encoded.push_str("\\f"),
            '\n' => encoded.push_str("\\n"),
            '\r' => encoded.push_str("\\r"),
            '\t' => encoded.push_str("\\t"),
            ch if ch <= '\u{1f}' => {
                encoded.push_str("\\u00");
                let code = ch as u8;
                encoded.push(hex_digit(code >> 4));
                encoded.push(hex_digit(code & 0x0f));
            }
            ch => encoded.push(ch),
        }
    }
    encoded.push('"');
    encoded
}

fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => char::from(b'0' + value),
        10..=15 => char::from(b'a' + value - 10),
        _ => '0',
    }
}
