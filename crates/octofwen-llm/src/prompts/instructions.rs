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

pub fn render_instruction_files(user_name: &str, files: &[InstructionFile]) -> String {
    if files.is_empty() {
        return String::new();
    }

    let rendered = files
        .iter()
        .map(render_instruction_file)
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "# Instructions from {user_name}\n\n\
{user_name} has left instructions in some config files. They're as follows, listed from\n\
most-general to most-specific:\n\n\
{rendered}\n\n\
These instructions are automatically kept fresh in your context space. You don't need to re-read\n\
these files."
    )
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
    format!(
        "Note: {}\n<instruction path=\"{}\">{}</instruction>",
        instruction_header(file.target),
        xml_escape(&file.path),
        xml_escape(&file.contents)
    )
}
