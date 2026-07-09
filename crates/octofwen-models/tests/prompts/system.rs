use octofwen_models::prompts::{DirectoryEntry, SystemPromptInput, system_prompt};

#[test]
fn system_prompt_renders_identity_workspace_listing_and_instruction_context() {
    let prompt = system_prompt(&SystemPromptInput {
        user_name: "Krystian".into(),
        working_directory: "/home/krystian/project".into(),
        directory_entries: vec![
            DirectoryEntry {
                entry: "package.json".into(),
                is_directory: false,
            },
            DirectoryEntry {
                entry: "source".into(),
                is_directory: true,
            },
        ],
        mcp_prompt: String::new(),
        instruction_prompt: "# Instructions from Krystian\n<instruction path=\"/home/krystian/project/AGENTS.md\">Use Bun &amp; &lt;escape&gt;</instruction>".into(),
    });

    assert!(
        prompt.starts_with("You are a coding assistant called Octo. The user's name is Krystian")
    );
    assert!(
        prompt
            .contains("Don't ask Krystian whether they want you to run a tool or make file edits")
    );
    assert!(prompt.contains("Your current working directory is: /home/krystian/project"));
    assert!(prompt.contains("{\"entry\":\"package.json\",\"isDirectory\":false}"));
    assert!(prompt.contains("{\"entry\":\"source\",\"isDirectory\":true}"));
    assert!(prompt.contains("# Instructions from Krystian"));
    assert!(prompt.contains("<instruction path=\"/home/krystian/project/AGENTS.md\">Use Bun &amp; &lt;escape&gt;</instruction>"));
}

#[test]
fn system_prompt_does_not_reprocess_template_tokens_from_values() {
    let prompt = system_prompt(&SystemPromptInput {
        user_name: "{{working_directory}}".into(),
        working_directory: "/workspace".into(),
        directory_entries: vec![],
        mcp_prompt: "{{instruction_prompt}}".into(),
        instruction_prompt: "literal instructions".into(),
    });

    assert!(prompt.contains("The user's name is {{working_directory}}"));
    assert!(prompt.contains("{{instruction_prompt}}"));
    assert!(prompt.contains("Your current working directory is: /workspace"));
}
