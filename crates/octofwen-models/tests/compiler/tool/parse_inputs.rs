use octofwen_models::compiler::{
    ToolParseInputProvider, ToolParseInputRequest, build_tool_parse_inputs,
};
use octofwen_models::providers::stream::ProviderStreamTool;
use serde_json::json;

#[test]
fn builds_chat_completions_tool_parse_inputs_with_empty_defaults() {
    let result = build_tool_parse_inputs(&ToolParseInputRequest {
        provider: ToolParseInputProvider::OpenAiChatCompletions,
        tools: vec![ProviderStreamTool {
            index: 3,
            id: None,
            name: Some("search".into()),
            arguments: None,
        }],
    });

    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].tool_call_id, "");
    assert_eq!(result.items[0].tool_name, "search");
    assert_eq!(result.items[0].args, json!(""));
}

#[test]
fn builds_responses_and_anthropic_tool_parse_inputs_with_index_id_fallback() {
    let tools = vec![ProviderStreamTool {
        index: 7,
        id: None,
        name: Some("edit".into()),
        arguments: Some("{\"filePath\":\"README.md\"}".into()),
    }];

    for provider in [
        ToolParseInputProvider::OpenAiResponses,
        ToolParseInputProvider::Anthropic,
        ToolParseInputProvider::Gemini,
    ] {
        let result = build_tool_parse_inputs(&ToolParseInputRequest {
            provider,
            tools: tools.clone(),
        });
        assert_eq!(result.items[0].tool_call_id, "7");
        assert_eq!(result.items[0].tool_name, "edit");
        assert_eq!(result.items[0].args, json!("{\"filePath\":\"README.md\"}"));
    }
}
