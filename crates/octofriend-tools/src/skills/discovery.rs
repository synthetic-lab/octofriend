use std::collections::HashSet;

use super::AgentSkill;
use super::loading::read_valid_skill;

const SKILL_FILE_NAME: &str = "SKILL.md";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectoryEntry {
    pub entry: String,
    pub is_directory: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HostPathEntry {
    File { contents: String },
    Directory { entries: Vec<DirectoryEntry> },
}

pub trait AgentSkillHost {
    fn cwd(&self) -> &str;
    fn get_env_var(&self, name: &str) -> String;
    fn path_exists(&self, path: &str) -> bool;
    fn read_file(&self, path: &str) -> Result<String, String>;
    fn read_dir(&self, path: &str) -> Result<Vec<DirectoryEntry>, String>;
}

#[derive(Default)]
struct SkillDiscoveryState {
    skills: Vec<AgentSkill>,
    seen_file_paths: HashSet<String>,
    seen_names: HashSet<String>,
}

pub fn discover_skills(
    host: &impl AgentSkillHost,
    configured_skill_paths: &[String],
    mut logger: impl FnMut(&str),
) -> Vec<AgentSkill> {
    let mut skill_paths = default_skill_paths(host);
    skill_paths.extend(configured_skill_paths.iter().cloned());

    let mut state = SkillDiscoveryState::default();

    for base_path in skill_paths {
        append_skills_from_path(host, &base_path, &mut state, &mut logger);
    }

    state.skills
}

fn default_skill_paths(host: &impl AgentSkillHost) -> Vec<String> {
    let home = host.get_env_var("HOME");
    vec![
        join_path(&home, ".config/agents/skills"),
        join_path(host.cwd(), ".agents/skills"),
    ]
}

fn append_skills_from_path(
    host: &impl AgentSkillHost,
    base_path: &str,
    state: &mut SkillDiscoveryState,
    logger: &mut impl FnMut(&str),
) {
    if !host.path_exists(base_path) {
        return;
    }

    for file_path in walk_skill_files(host, base_path) {
        if !state.seen_file_paths.insert(file_path.clone()) {
            continue;
        }

        let Some(skill) = read_valid_skill(host, &file_path, &state.seen_names, logger) else {
            continue;
        };

        state.seen_names.insert(skill.name.clone());
        state.skills.push(skill);
    }
}

fn walk_skill_files(host: &impl AgentSkillHost, dir_path: &str) -> Vec<String> {
    let Ok(entries) = host.read_dir(dir_path) else {
        return Vec::new();
    };

    let mut skill_files = Vec::new();
    for entry in entries {
        let full_path = join_path(dir_path, &entry.entry);
        if entry.is_directory {
            skill_files.extend(walk_skill_files(host, &full_path));
        } else if entry.entry == SKILL_FILE_NAME {
            skill_files.push(full_path);
        }
    }

    skill_files
}

pub(crate) fn join_path(base: &str, child: &str) -> String {
    if base.is_empty() {
        return child.into();
    }
    if base.ends_with('/') {
        format!("{base}{child}")
    } else {
        format!("{base}/{child}")
    }
}
