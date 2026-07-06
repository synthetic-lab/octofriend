use octofwen_llm::compiler::{CompilerTokenBuffer, CompilerTokenType};

#[test]
fn compiler_token_buffer_tracks_reasoning_content_and_tool_tokens() {
    let mut buffer = CompilerTokenBuffer::default();

    buffer.push(CompilerTokenType::Reasoning, "why", true);
    buffer.push(CompilerTokenType::Content, "answer", true);
    buffer.push(CompilerTokenType::Tool, "{\"x\":1}", true);

    assert_eq!(buffer.reasoning, "why");
    assert_eq!(buffer.content, "answer");
    assert_eq!(buffer.tool, "{\"x\":1}");
    assert!(!buffer.unexpected_tool_call);
}

#[test]
fn compiler_token_buffer_flags_tool_tokens_when_tools_are_not_enabled() {
    let mut buffer = CompilerTokenBuffer::default();

    buffer.push(CompilerTokenType::Tool, "unexpected", false);

    assert_eq!(buffer.tool, "");
    assert!(buffer.unexpected_tool_call);
}
