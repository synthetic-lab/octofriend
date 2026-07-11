use std::collections::{BTreeMap, BTreeSet};

use octofriend_tools::skills::{AgentSkillHost, DirectoryEntry, HostPathEntry, discover_skills};

#[derive(Default)]
struct MemorySkillHost {
    cwd: String,
    home: String,
    entries: BTreeMap<String, HostPathEntry>,
    unreadable_files: BTreeSet<String>,
}

impl AgentSkillHost for MemorySkillHost {
    fn cwd(&self) -> &str {
        &self.cwd
    }

    fn get_env_var(&self, name: &str) -> String {
        if name == "HOME" {
            self.home.clone()
        } else {
            String::new()
        }
    }

    fn path_exists(&self, path: &str) -> bool {
        self.entries.contains_key(path)
    }

    fn read_file(&self, path: &str) -> Result<String, String> {
        if self.unreadable_files.contains(path) {
            return Err(format!("missing file {path}"));
        }
        match self.entries.get(path) {
            Some(HostPathEntry::File { contents }) => Ok(contents.clone()),
            _ => Err(format!("missing file {path}")),
        }
    }

    fn read_dir(&self, path: &str) -> Result<Vec<DirectoryEntry>, String> {
        match self.entries.get(path) {
            Some(HostPathEntry::Directory { entries }) => Ok(entries.clone()),
            _ => Err(format!("missing directory {path}")),
        }
    }
}

fn skill_file(name: &str, description: &str) -> String {
    format!("---\nname: {name}\ndescription: {description}\n---\n\nUse this skill.\n")
}

#[test]
fn discovers_valid_skills_from_default_and_configured_paths() {
    let host = MemorySkillHost {
        cwd: "/workspace/project".into(),
        home: "/home/user".into(),
        entries: BTreeMap::from([
            (
                "/home/user/.config/agents/skills".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "global-skill".into(),
                        is_directory: true,
                    }],
                },
            ),
            (
                "/home/user/.config/agents/skills/global-skill".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/home/user/.config/agents/skills/global-skill/SKILL.md".into(),
                HostPathEntry::File {
                    contents: skill_file("global-skill", "Global skill."),
                },
            ),
            (
                "/workspace/project/.agents/skills".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "project-skill".into(),
                        is_directory: true,
                    }],
                },
            ),
            (
                "/workspace/project/.agents/skills/project-skill".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/workspace/project/.agents/skills/project-skill/SKILL.md".into(),
                HostPathEntry::File {
                    contents: skill_file("project-skill", "Project skill."),
                },
            ),
            (
                "/custom/skills".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "custom-skill".into(),
                        is_directory: true,
                    }],
                },
            ),
            (
                "/custom/skills/custom-skill".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/custom/skills/custom-skill/SKILL.md".into(),
                HostPathEntry::File {
                    contents: skill_file("custom-skill", "Custom skill."),
                },
            ),
        ]),
        unreadable_files: BTreeSet::new(),
    };

    let mut logs = Vec::new();
    let skills = discover_skills(&host, &["/custom/skills".into()], |message| {
        logs.push(message.to_owned());
    });

    assert_eq!(
        skills
            .into_iter()
            .map(|skill| skill.name)
            .collect::<Vec<_>>(),
        vec!["global-skill", "project-skill", "custom-skill"]
    );
    assert!(logs.is_empty());
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "single scenario documents full skill discovery rejection order"
)]
fn skips_unparsable_invalid_duplicate_unreadable_and_missing_skill_paths() {
    let mut host = MemorySkillHost {
        cwd: "/workspace/project".into(),
        home: "/home/user".into(),
        entries: BTreeMap::from([
            (
                "/home/user/.config/agents/skills".into(),
                HostPathEntry::Directory {
                    entries: vec![
                        DirectoryEntry {
                            entry: "valid-skill".into(),
                            is_directory: true,
                        },
                        DirectoryEntry {
                            entry: "bad-frontmatter".into(),
                            is_directory: true,
                        },
                        DirectoryEntry {
                            entry: "wrong-directory".into(),
                            is_directory: true,
                        },
                        DirectoryEntry {
                            entry: "unreadable".into(),
                            is_directory: true,
                        },
                    ],
                },
            ),
            (
                "/home/user/.config/agents/skills/valid-skill".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/home/user/.config/agents/skills/valid-skill/SKILL.md".into(),
                HostPathEntry::File {
                    contents: skill_file("valid-skill", "Valid skill."),
                },
            ),
            (
                "/home/user/.config/agents/skills/bad-frontmatter".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/home/user/.config/agents/skills/bad-frontmatter/SKILL.md".into(),
                HostPathEntry::File {
                    contents: "not frontmatter".into(),
                },
            ),
            (
                "/home/user/.config/agents/skills/wrong-directory".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/home/user/.config/agents/skills/wrong-directory/SKILL.md".into(),
                HostPathEntry::File {
                    contents: skill_file("different-name", "Wrong directory."),
                },
            ),
            (
                "/home/user/.config/agents/skills/unreadable".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/home/user/.config/agents/skills/unreadable/SKILL.md".into(),
                HostPathEntry::File {
                    contents: skill_file("unreadable", "Unreadable skill."),
                },
            ),
            (
                "/custom/skills".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "valid-skill".into(),
                        is_directory: true,
                    }],
                },
            ),
            (
                "/custom/skills/valid-skill".into(),
                HostPathEntry::Directory {
                    entries: vec![DirectoryEntry {
                        entry: "SKILL.md".into(),
                        is_directory: false,
                    }],
                },
            ),
            (
                "/custom/skills/valid-skill/SKILL.md".into(),
                HostPathEntry::File {
                    contents: skill_file("valid-skill", "Duplicate skill."),
                },
            ),
        ]),
        unreadable_files: BTreeSet::new(),
    };
    host.unreadable_files
        .insert("/home/user/.config/agents/skills/unreadable/SKILL.md".into());

    let mut logs = Vec::new();
    let skills = discover_skills(
        &host,
        &["/custom/skills".into(), "/missing/skills".into()],
        |message| logs.push(message.to_owned()),
    );

    assert_eq!(
        skills
            .into_iter()
            .map(|skill| skill.name)
            .collect::<Vec<_>>(),
        vec!["valid-skill"]
    );
    let joined = logs.join("\n");
    assert!(joined.contains("Failed to parse skill file"));
    assert!(joined.contains("Skill validation failed"));
    assert!(joined.contains("Duplicate skill name"));
    assert!(joined.contains("Error reading skill file"));
}
