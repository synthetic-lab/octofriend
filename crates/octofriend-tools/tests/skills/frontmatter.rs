use std::collections::BTreeMap;

use octofriend_tools::skills::{
    AgentSkill, parse_skill_content, render_skills_prompt_xml, validate_skill,
};

#[test]
fn parses_a_full_skill_file_with_frontmatter_and_body() {
    let content = r#"---
name: pdf-processing
description: Extracts text and tables from PDF files.
license: MIT
compatibility: Requires python 3.8+
metadata:
  author: test-org
  version: "1.0"
---

# PDF Processing

Use this skill when working with PDFs.
"#;

    let skill = parse_skill_content(content, "/skills/pdf-processing/SKILL.md")
        .expect("skill should parse");

    assert_eq!(skill.name, "pdf-processing");
    assert_eq!(
        skill.description,
        "Extracts text and tables from PDF files."
    );
    assert_eq!(skill.license.as_deref(), Some("MIT"));
    assert_eq!(skill.compatibility.as_deref(), Some("Requires python 3.8+"));
    assert_eq!(
        skill.metadata,
        BTreeMap::from([
            ("author".into(), "test-org".into()),
            ("version".into(), "1.0".into()),
        ])
    );
    assert_eq!(
        skill.instructions,
        "# PDF Processing\n\nUse this skill when working with PDFs."
    );
    assert_eq!(skill.path, "/skills/pdf-processing");
    assert_eq!(skill.skill_file_path, "/skills/pdf-processing/SKILL.md");
}

#[test]
fn returns_none_for_missing_malformed_or_incomplete_frontmatter() {
    assert!(parse_skill_content("# Just Markdown", "/test/SKILL.md").is_none());
    assert!(
        parse_skill_content(
            "---\nname: broken\ndescription: Missing closing delimiter\n",
            "/test/SKILL.md"
        )
        .is_none()
    );
    assert!(
        parse_skill_content(
            "---\nname: no-description\n---\n\nContent here.",
            "/test/SKILL.md"
        )
        .is_none()
    );
}

#[test]
fn handles_crlf_line_endings() {
    let content = "---\r\nname: crlf-skill\r\ndescription: Works with Windows line endings.\r\n---\r\n\r\nInstructions.";

    assert_eq!(
        parse_skill_content(content, "/test/SKILL.md").map(|skill| skill.name),
        Some("crlf-skill".into())
    );
}

#[test]
fn validates_skill_metadata_constraints() {
    let valid = AgentSkill {
        name: "valid-skill".into(),
        description: "A valid skill description.".into(),
        license: None,
        compatibility: None,
        metadata: BTreeMap::new(),
        instructions: "Do things.".into(),
        path: "/skills/valid-skill".into(),
        skill_file_path: "/skills/valid-skill/SKILL.md".into(),
    };

    assert_eq!(validate_skill(&valid), Vec::<String>::new());
    assert!(
        validate_skill(&AgentSkill {
            name: String::new(),
            ..valid.clone()
        })
        .contains(&"name is required".into())
    );
    assert!(
        validate_skill(&AgentSkill {
            description: String::new(),
            ..valid.clone()
        })
        .contains(&"description is required".into())
    );
    assert!(
        validate_skill(&AgentSkill {
            name: "-invalid-name".into(),
            path: String::new(),
            ..valid.clone()
        })
        .join("\n")
        .contains("alphanumeric")
    );
    assert!(
        validate_skill(&AgentSkill {
            name: "skill-one".into(),
            path: "/skills/skill-two".into(),
            ..valid.clone()
        })
        .join("\n")
        .contains("must match directory")
    );
    assert!(
        validate_skill(&AgentSkill {
            name: "a".repeat(65),
            path: String::new(),
            ..valid.clone()
        })
        .join("\n")
        .contains("exceeds 64")
    );
    assert!(
        validate_skill(&AgentSkill {
            description: "a".repeat(1025),
            ..valid.clone()
        })
        .join("\n")
        .contains("description exceeds")
    );
    assert!(
        validate_skill(&AgentSkill {
            compatibility: Some("a".repeat(501)),
            ..valid.clone()
        })
        .join("\n")
        .contains("compatibility exceeds")
    );
    assert_eq!(
        validate_skill(&AgentSkill {
            name: "MySkill".into(),
            path: "/skills/MySkill".into(),
            ..valid
        }),
        Vec::<String>::new()
    );
}

#[test]
fn renders_skills_as_escaped_prompt_xml() {
    let xml = render_skills_prompt_xml(&[AgentSkill {
        name: "data-analysis".into(),
        description: "Analyzes datasets & charts with <tags> and \"quotes\".".into(),
        license: None,
        compatibility: None,
        metadata: BTreeMap::new(),
        instructions: String::new(),
        path: "/skills/data-analysis".into(),
        skill_file_path: "/skills/data-analysis/SKILL.md".into(),
    }]);

    assert_eq!(
        xml,
        "<available_skills>\n  <skill>\n    <name>data-analysis</name>\n    <description>Analyzes datasets &amp; charts with &lt;tags&gt; and &quot;quotes&quot;.</description>\n    <location>/skills/data-analysis/SKILL.md</location>\n  </skill>\n</available_skills>"
    );
    assert_eq!(render_skills_prompt_xml(&[]), "");
}
