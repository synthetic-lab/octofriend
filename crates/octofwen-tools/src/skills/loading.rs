use std::collections::HashSet;

use super::{AgentSkill, AgentSkillHost, parse_skill_content, validate_skill};

pub fn read_valid_skill(
    host: &impl AgentSkillHost,
    file_path: &str,
    seen_names: &HashSet<String>,
    logger: &mut impl FnMut(&str),
) -> Option<AgentSkill> {
    let content = match host.read_file(file_path) {
        Ok(content) => content,
        Err(error) => {
            logger(&format!("Error reading skill file {file_path}: {error}"));
            return None;
        }
    };

    let Some(skill) = parse_skill_content(&content, file_path) else {
        logger(&format!("Failed to parse skill file: {file_path}"));
        return None;
    };

    let errors = validate_skill(&skill);
    if !errors.is_empty() {
        logger(&format!(
            "Skill validation failed for {file_path}: {}",
            errors.join(", ")
        ));
        return None;
    }

    if seen_names.contains(&skill.name) {
        logger(&format!(
            "Duplicate skill name \"{}\" at {file_path}, skipping",
            skill.name
        ));
        return None;
    }

    Some(skill)
}
