use super::template::render_markdown_template;

const TOOL_SKIP_PROMPT: &str = include_str!("templates/tool_skip.md");
const IMAGE_ATTACHMENT_PLACEHOLDER_TEXT: &str =
    include_str!("templates/image_attachment_placeholder.md");

pub fn tool_skip(reason: &str) -> String {
    render_markdown_template(TOOL_SKIP_PROMPT, &[("reason", reason)])
        .trim_end_matches('\n')
        .to_owned()
}

pub fn image_attachment_placeholder_text() -> String {
    render_markdown_template(IMAGE_ATTACHMENT_PLACEHOLDER_TEXT, &[])
}
