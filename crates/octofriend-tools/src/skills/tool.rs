use crate::runtime::{RuntimeTool, TOOL_BUILDER, ToolCall, ToolContent, ToolReturn};
use serde_json::{Value, json};

use super::AgentSkill;

pub fn skill_runtime_tool(skills: &[AgentSkill]) -> Option<RuntimeTool> {
    TOOL_BUILDER.dynamic_define_tool(|| {
        if skills.is_empty() {
            return None;
        }

        Some(
            TOOL_BUILDER
                .declare(
                    "skill",
                    skill_tool_description(skills),
                    skill_tool_arguments_schema(skills),
                )
                .define(),
        )
    })
}

pub fn run_agent_skill_tool(
    user_name: &str,
    skills: &[AgentSkill],
    tool_call: &ToolCall,
) -> Result<ToolReturn, String> {
    let skill_name = skill_name_argument(&tool_call.parsed)?;
    let Some(skill) = skills.iter().find(|candidate| candidate.name == skill_name) else {
        return Ok(text_output(format!("Unknown skill: {skill_name}")));
    };

    Ok(text_output(render_agent_skill_output(user_name, skill)))
}

fn skill_tool_description(skills: &[AgentSkill]) -> String {
    let descriptions = skills
        .iter()
        .map(|skill| json!({ "name": skill.name, "description": skill.description }))
        .collect::<Vec<_>>();
    format!(
        "Loads and displays the instructions for a skill. Available skills: {}",
        Value::Array(descriptions)
    )
}

fn skill_tool_arguments_schema(skills: &[AgentSkill]) -> Value {
    json!({
        "type": "object",
        "required": ["skillName"],
        "properties": {
            "skillName": {
                "enum": skills.iter().map(|skill| skill.name.clone()).collect::<Vec<_>>()
            }
        }
    })
}

fn skill_name_argument(parsed: &Value) -> Result<&str, String> {
    parsed
        .as_object()
        .and_then(|object| object.get("skillName"))
        .and_then(Value::as_str)
        .ok_or_else(|| "skill tool argument skillName must be a string".into())
}

fn render_agent_skill_output(user_name: &str, skill: &AgentSkill) -> String {
    format!(
        "\
Skill name: {}
Skill directory: {}
Description: {}

{} has set up a skill for you to use. Skills are:

1. A SKILL.md file containing instructions for you, in a directory.
2. Optional scripts or assets stored in subdirectories of the skill's directory.

If there are scripts or assets stored in directories or subdirectories, typically they will be
referenced in the SKILL.md instructions. If there are no instructions relating to scripts or assets,
it's likely that they don't exist for this skill.

Here are the contents of the SKILL.md file stored at {}:
---
{}",
        skill.name,
        skill.path,
        skill.description,
        user_name,
        skill.skill_file_path,
        skill.instructions
    )
}

fn text_output(content: impl Into<String>) -> ToolReturn {
    ToolReturn::Output {
        content: vec![ToolContent::Text {
            content: content.into(),
        }],
        lines: None,
    }
}
