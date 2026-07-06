use octofwen_llm::prompts::compaction_prompt;

#[test]
fn compaction_prompt_renders_context_summary_instructions() {
    let prompt = compaction_prompt();

    assert!(prompt.starts_with(
        "Generate a summary of everything you've talked about and done in this conversation."
    ));
    assert!(prompt.contains(
        "**IMPORTANT**: You are NOT continuing the conversation or responding to the user."
    ));
    assert!(prompt.contains("<analysis>"));
    assert!(prompt.contains("## Primary Request"));
    assert!(prompt.contains("## Work Completed"));
    assert!(prompt.contains("## Context for Resuming"));
    assert!(prompt.ends_with("This is technical documentation, not a conversation\n"));
}
