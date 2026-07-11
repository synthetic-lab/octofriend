use octofriend_models::prompts::{close_tag, open_tag, tagged, xml_escape};

#[test]
fn xml_prompt_helpers_build_open_close_and_wrapped_tags() {
    assert_eq!(
        open_tag("tool", &[("name", "read"), ("id", "call-1")]),
        "<tool name=\"read\" id=\"call-1\">"
    );
    assert_eq!(close_tag("tool"), "</tool>");
    assert_eq!(
        tagged("tool", &[("name", "read")], &["content"]),
        "<tool name=\"read\">content</tool>"
    );
}

#[test]
fn xml_escape_escapes_xml_sensitive_characters_in_legacy_order() {
    assert_eq!(
        xml_escape("A&B <tag attr=\"'\">"),
        "A&amp;B &lt;tag attr=&quot;&apos;&quot;&gt;"
    );
}
