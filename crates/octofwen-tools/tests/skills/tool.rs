use std::collections::BTreeMap;

use octofwen_tools::runtime::{ToolContent, ToolReturn, flatten_tool_call};
use octofwen_tools::skills::{AgentSkill, run_agent_skill_tool, skill_runtime_tool};
use serde_json::json;

fn skill() -> AgentSkill {
    AgentSkill {
        name: "review-code".into(),
        description: "Reviews source changes.".into(),
        license: None,
        compatibility: None,
        metadata: BTreeMap::new(),
        instructions: "Inspect the diff before commenting.".into(),
        path: "/home/user/.config/agents/skills/review-code".into(),
        skill_file_path: "/home/user/.config/agents/skills/review-code/SKILL.md".into(),
    }
}

#[test]
fn skill_runtime_tool_is_absent_without_discovered_skills() {
    assert!(skill_runtime_tool(&[]).is_none());
}

#[test]
fn skill_runtime_tool_declares_available_skills_and_allowed_names() {
    let tool = skill_runtime_tool(&[skill()]).expect("skill tool should be enabled");

    assert_eq!(tool.definition.name, "skill");
    assert!(tool.definition.description.contains("review-code"));
    assert_eq!(
        tool.definition.arguments_schema,
        json!({
            "type": "object",
            "required": ["skillName"],
            "properties": {
                "skillName": {
                    "enum": ["review-code"]
                }
            }
        })
    );
}

#[test]
fn run_agent_skill_tool_renders_selected_skill_instructions() {
    let tool_call = flatten_tool_call(
        "call-1",
        "skill",
        json!({ "skillName": "review-code" }),
        json!({ "skillName": "review-code" }),
    );

    let result = run_agent_skill_tool("Octo", &[skill()], &tool_call);

    assert_eq!(
        result,
        Ok(ToolReturn::Output {
            content: vec![ToolContent::Text {
                content: "Skill name: review-code\nSkill directory: /home/user/.config/agents/skills/review-code\nDescription: Reviews source changes.\n\nOcto has set up a skill for you to use. Skills are:\n\n1. A SKILL.md file containing instructions for you, in a directory.\n2. Optional scripts or assets stored in subdirectories of the skill's directory.\n\nIf there are scripts or assets stored in directories or subdirectories, typically they will be\nreferenced in the SKILL.md instructions. If there are no instructions relating to scripts or assets,\nit's likely that they don't exist for this skill.\n\nHere are the contents of the SKILL.md file stored at /home/user/.config/agents/skills/review-code/SKILL.md:\n---\nInspect the diff before commenting.".into(),
            }],
            lines: None,
        })
    );
}

#[test]
fn run_agent_skill_tool_reports_unknown_skills_as_text_output() {
    let tool_call = flatten_tool_call(
        "call-1",
        "skill",
        json!({ "skillName": "missing" }),
        json!({ "skillName": "missing" }),
    );

    assert_eq!(
        run_agent_skill_tool("Octo", &[skill()], &tool_call),
        Ok(ToolReturn::Output {
            content: vec![ToolContent::Text {
                content: "Unknown skill: missing".into(),
            }],
            lines: None,
        })
    );
}
