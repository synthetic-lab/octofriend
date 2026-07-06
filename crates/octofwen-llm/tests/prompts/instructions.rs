use octofwen_llm::prompts::{
    InstructionFile, InstructionTarget, instruction_header, render_instruction_files,
};

#[test]
fn render_instruction_files_escapes_xml_content_and_orders_loaded_files() {
    let rendered = render_instruction_files(
        "Ada",
        &[
            InstructionFile {
                path: "/repo/AGENTS.md".into(),
                target: InstructionTarget::Agents,
                contents: "Use <safe> & typed APIs.".into(),
            },
            InstructionFile {
                path: "/repo/.agents/AGENTS.md".into(),
                target: InstructionTarget::AgentsDirectory,
                contents: "Prefer \"focused\" changes.".into(),
            },
        ],
    );

    assert!(rendered.starts_with("# Instructions from Ada"));
    assert!(rendered.contains("Ada has left instructions in some config files."));
    assert!(rendered.contains("This is a generic instruction for automated agents."));
    assert!(rendered.contains("This is a repository-local instruction file for automated agents."));
    assert!(rendered.contains(
        "<instruction path=\"/repo/AGENTS.md\">Use &lt;safe&gt; &amp; typed APIs.</instruction>"
    ));
    assert!(rendered.contains("<instruction path=\"/repo/.agents/AGENTS.md\">Prefer &quot;focused&quot; changes.</instruction>"));
    assert!(rendered.ends_with("These instructions are automatically kept fresh in your context space. You don't need to re-read\nthese files."));
}

#[test]
fn render_instruction_files_returns_empty_section_for_no_files() {
    assert_eq!(render_instruction_files("Ada", &[]), "");
}

#[test]
fn instruction_header_describes_supported_instruction_targets() {
    assert!(instruction_header(InstructionTarget::Agents).contains("automated agents"));
    assert!(instruction_header(InstructionTarget::Claude).contains("Claude"));
    assert!(instruction_header(InstructionTarget::AgentsDirectory).contains("repository-local"));
}

#[test]
fn render_instruction_files_does_not_reprocess_template_tokens_from_values() {
    let rendered = render_instruction_files(
        "{{rendered}}",
        &[InstructionFile {
            path: "/repo/AGENTS.md".into(),
            target: InstructionTarget::Agents,
            contents: "Use {{user_name}} literally.".into(),
        }],
    );

    assert!(rendered.contains("# Instructions from {{rendered}}"));
    assert!(rendered.contains("Use {{user_name}} literally."));
}
