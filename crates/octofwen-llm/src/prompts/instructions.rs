use super::template::render_markdown_template;
use crate::prompts::xml::xml_escape;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstructionTarget {
    Claude,
    Agents,
    AgentsDirectory,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstructionFile {
    pub path: String,
    pub target: InstructionTarget,
    pub contents: String,
}

const INSTRUCTIONS_PROMPT: &str = include_str!("templates/instructions.md");
const INSTRUCTION_FILE_PROMPT: &str = include_str!("templates/instruction_file.md");

pub fn render_instruction_files(user_name: &str, files: &[InstructionFile]) -> String {
    if files.is_empty() {
        return String::new();
    }

    let rendered = files
        .iter()
        .map(render_instruction_file)
        .collect::<Vec<_>>()
        .join("\n\n");

    render_markdown_template(
        INSTRUCTIONS_PROMPT,
        &[("user_name", user_name), ("rendered", &rendered)],
    )
    .trim_end_matches('\n')
    .to_owned()
}

pub fn instruction_header(target: InstructionTarget) -> &'static str {
    match target {
        InstructionTarget::Claude => {
            "This is an instruction file for Claude, a different LLM, but you may find it useful."
        }
        InstructionTarget::Agents => {
            "This is a generic instruction for automated agents. You may find it useful."
        }
        InstructionTarget::AgentsDirectory => {
            "This is a repository-local instruction file for automated agents. You may find it useful."
        }
    }
}

fn render_instruction_file(file: &InstructionFile) -> String {
    render_markdown_template(
        INSTRUCTION_FILE_PROMPT,
        &[
            ("instruction_header", instruction_header(file.target)),
            ("path", &xml_escape(&file.path)),
            ("contents", &xml_escape(&file.contents)),
        ],
    )
    .trim_end_matches('\n')
    .to_owned()
}
