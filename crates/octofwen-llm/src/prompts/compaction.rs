use super::template::render_markdown_template;

const COMPACTION_PROMPT: &str = include_str!("templates/compaction.md");

pub fn compaction_prompt() -> String {
    render_markdown_template(COMPACTION_PROMPT, &[])
}
