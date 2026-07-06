use std::collections::BTreeMap;
use std::path::Path;

const MAX_NAME_LENGTH: usize = 64;
const MAX_DESCRIPTION_LENGTH: usize = 1024;
const MAX_COMPATIBILITY_LENGTH: usize = 500;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentSkill {
    pub name: String,
    pub description: String,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub instructions: String,
    pub path: String,
    pub skill_file_path: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AgentSkillFrontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub metadata: BTreeMap<String, String>,
}

pub fn validate_skill(skill: &AgentSkill) -> Vec<String> {
    let mut errors = Vec::new();

    if skill.name.is_empty() {
        errors.push("name is required".into());
    } else {
        if skill.name.len() > MAX_NAME_LENGTH {
            errors.push(format!("name exceeds {MAX_NAME_LENGTH} characters"));
        }
        if !valid_skill_name(&skill.name) {
            errors.push(
                "name must be alphanumeric with hyphens, no leading/trailing/consecutive hyphens"
                    .into(),
            );
        }
        if !skill.path.is_empty() {
            let dir_name = path_basename(&skill.path);
            if !dir_name.eq_ignore_ascii_case(&skill.name) {
                errors.push(format!(
                    "name \"{}\" must match directory \"{dir_name}\"",
                    skill.name
                ));
            }
        }
    }

    if skill.description.is_empty() {
        errors.push("description is required".into());
    } else if skill.description.len() > MAX_DESCRIPTION_LENGTH {
        errors.push(format!(
            "description exceeds {MAX_DESCRIPTION_LENGTH} characters"
        ));
    }

    if skill
        .compatibility
        .as_ref()
        .is_some_and(|compatibility| compatibility.len() > MAX_COMPATIBILITY_LENGTH)
    {
        errors.push(format!(
            "compatibility exceeds {MAX_COMPATIBILITY_LENGTH} characters"
        ));
    }

    errors
}

pub fn parse_skill_content(content: &str, file_path: &str) -> Option<AgentSkill> {
    let split = split_frontmatter(content)?;
    let frontmatter = parse_skill_frontmatter(&split.frontmatter)?;
    let name = frontmatter.name?;
    let description = frontmatter.description?;

    Some(AgentSkill {
        name,
        description,
        license: frontmatter.license,
        compatibility: frontmatter.compatibility,
        metadata: frontmatter.metadata,
        instructions: split.body,
        path: path_dirname(file_path),
        skill_file_path: file_path.into(),
    })
}

pub fn render_skills_prompt_xml(skills: &[AgentSkill]) -> String {
    if skills.is_empty() {
        return String::new();
    }

    let mut lines = vec!["<available_skills>".to_owned()];
    for skill in skills {
        lines.push("  <skill>".into());
        lines.push(format!("    <name>{}</name>", escape_xml(&skill.name)));
        lines.push(format!(
            "    <description>{}</description>",
            escape_xml(&skill.description)
        ));
        lines.push(format!(
            "    <location>{}</location>",
            escape_xml(&skill.skill_file_path)
        ));
        lines.push("  </skill>".into());
    }
    lines.push("</available_skills>".into());

    lines.join("\n")
}

struct SplitFrontmatter {
    frontmatter: String,
    body: String,
}

fn split_frontmatter(content: &str) -> Option<SplitFrontmatter> {
    let normalized = content.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return None;
    }

    let rest = &normalized[4..];
    let end_index = rest.find("\n---")?;

    Some(SplitFrontmatter {
        frontmatter: rest[..end_index].into(),
        body: rest[end_index + 4..].trim().into(),
    })
}

fn parse_skill_frontmatter(frontmatter: &str) -> Option<AgentSkillFrontmatter> {
    let mut parsed = AgentSkillFrontmatter::default();
    let mut in_metadata = false;

    for line in frontmatter.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if in_metadata && line.starts_with("  ") {
            let (key, value) = parse_key_value(line.trim())?;
            parsed.metadata.insert(key.into(), unquote_scalar(value));
            continue;
        }

        in_metadata = false;
        let (key, value) = parse_key_value(line)?;
        match key {
            "name" => parsed.name = Some(unquote_scalar(value)),
            "description" => parsed.description = Some(unquote_scalar(value)),
            "license" => parsed.license = Some(unquote_scalar(value)),
            "compatibility" => parsed.compatibility = Some(unquote_scalar(value)),
            "metadata" if value.trim().is_empty() => in_metadata = true,
            "metadata" => return None,
            _ => {}
        }
    }

    Some(parsed)
}

fn parse_key_value(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    Some((key.trim(), value.trim()))
}

fn unquote_scalar(value: &str) -> String {
    let quoted = (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''));
    if quoted && value.len() >= 2 {
        value[1..value.len() - 1].into()
    } else {
        value.into()
    }
}

fn valid_skill_name(name: &str) -> bool {
    let mut previous_hyphen = false;
    let mut chars = name.chars().peekable();
    if chars.peek().is_none() {
        return false;
    }

    for (index, character) in name.chars().enumerate() {
        if character == '-' {
            if index == 0 || previous_hyphen {
                return false;
            }
            previous_hyphen = true;
            continue;
        }

        if !character.is_ascii_alphanumeric() {
            return false;
        }
        previous_hyphen = false;
    }

    !previous_hyphen
}

fn path_dirname(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
