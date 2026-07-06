use octofwen_llm::providers::stream::{
    AnthropicThinkingBlock, ProviderOpenAiResponsesMetadata, ProviderStreamEvent,
    ProviderStreamState, ProviderTokenKind, ProviderToolDelta, apply_provider_stream_events,
};
use octofwen_llm::providers::{anthropic, openai};
use serde_json::json;

#[test]
fn normalizes_openai_chat_completion_content_reasoning_tool_and_usage_chunks() {
    assert_eq!(
        openai::openai_chat_completions_stream_events(&json!({
            "choices": [{
                "delta": {
                    "content": "hello",
                    "reasoning_content": "thinking",
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "function": { "name": "read", "arguments": "{\"path\"" }
                    }]
                }
            }],
            "usage": {
                "prompt_tokens": 7,
                "prompt_tokens_details": { "cached_tokens": 2 },
                "completion_tokens": 3
            }
        })),
        vec![
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Content,
                text: "hello".into(),
            },
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Reasoning,
                text: "thinking".into(),
            },
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 0,
                id: Some("call_1".into()),
                name: Some("read".into()),
                arguments: Some("{\"path\"".into()),
            }),
            ProviderStreamEvent::Usage {
                input: 7,
                cached_input: 2,
                output: 3,
                reasoning_output: 0,
            },
        ]
    );
}

#[test]
fn normalizes_openai_responses_stream_events() {
    assert_eq!(
        openai::openai_responses_stream_events(&json!({
            "type": "response.output_text.delta",
            "delta": "hello"
        })),
        vec![ProviderStreamEvent::Token {
            kind: ProviderTokenKind::Content,
            text: "hello".into(),
        }]
    );

    assert_eq!(
        openai::openai_responses_stream_events(&json!({
            "type": "response.reasoning_summary_text.delta",
            "delta": "thinking"
        })),
        vec![ProviderStreamEvent::Token {
            kind: ProviderTokenKind::Reasoning,
            text: "thinking".into(),
        }]
    );

    assert_eq!(
        openai::openai_responses_stream_events(&json!({
            "type": "response.function_call_arguments.delta",
            "delta": "{}"
        })),
        vec![ProviderStreamEvent::Token {
            kind: ProviderTokenKind::Tool,
            text: "{}".into(),
        }]
    );

    assert_eq!(
        openai::openai_responses_stream_events(&json!({
            "type": "response.output_item.done",
            "item": {
                "type": "function_call",
                "call_id": "call_1",
                "name": "read",
                "arguments": "{\"path\":\"README.md\"}"
            }
        })),
        vec![ProviderStreamEvent::ToolDelta(ProviderToolDelta {
            index: 0,
            id: Some("call_1".into()),
            name: Some("read".into()),
            arguments: Some("{\"path\":\"README.md\"}".into()),
        })]
    );

    assert_eq!(
        openai::openai_responses_stream_events(&json!({
            "type": "response.completed",
            "response": {
                "output": [],
                "usage": {
                    "input_tokens": 11,
                    "input_tokens_details": { "cached_tokens": 4 },
                    "output_tokens": 5,
                    "output_tokens_details": { "reasoning_tokens": 2 }
                }
            }
        })),
        vec![ProviderStreamEvent::Usage {
            input: 11,
            cached_input: 4,
            output: 5,
            reasoning_output: 2,
        }]
    );

    assert_eq!(
        openai::openai_responses_stream_events(&json!({
            "type": "response.output_item.done",
            "item": {
                "type": "reasoning",
                "id": "rs_1",
                "encrypted_content": "encrypted",
                "content": [{ "text": "private chain" }],
                "summary": [{ "text": "summary" }]
            }
        })),
        vec![ProviderStreamEvent::OpenAiResponsesMetadata(
            ProviderOpenAiResponsesMetadata {
                reasoning_id: Some("rs_1".into()),
                encrypted_reasoning_content: Some("encrypted".into()),
                reasoning_text: Some("private chain\nsummary".into()),
            }
        )]
    );
}

#[test]
fn normalizes_anthropic_messages_stream_events() {
    assert_eq!(
        anthropic::anthropic_messages_stream_events(&json!({
            "type": "content_block_start",
            "index": 1,
            "content_block": {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "read"
            }
        })),
        vec![
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Tool,
                text: "read".into(),
            },
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 1,
                id: Some("toolu_1".into()),
                name: Some("read".into()),
                arguments: None,
            }),
        ]
    );

    assert_eq!(
        anthropic::anthropic_messages_stream_events(&json!({
            "type": "content_block_delta",
            "index": 1,
            "delta": { "type": "input_json_delta", "partial_json": "{\"path\"" }
        })),
        vec![
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Tool,
                text: "{\"path\"".into(),
            },
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 1,
                id: None,
                name: None,
                arguments: Some("{\"path\"".into()),
            }),
        ]
    );

    assert_eq!(
        anthropic::anthropic_messages_stream_events(&json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": "hello" }
        })),
        vec![ProviderStreamEvent::Token {
            kind: ProviderTokenKind::Content,
            text: "hello".into(),
        }]
    );

    assert_eq!(
        anthropic::anthropic_messages_stream_events(&json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "thinking_delta", "thinking": "thinking" }
        })),
        vec![
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Reasoning,
                text: "thinking".into(),
            },
            ProviderStreamEvent::AnthropicThinkingDelta {
                index: 0,
                thinking: Some("thinking".into()),
                signature: None,
            },
        ]
    );

    assert_eq!(
        anthropic::anthropic_messages_stream_events(&json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "signature_delta", "signature": "sig" }
        })),
        vec![ProviderStreamEvent::AnthropicThinkingDelta {
            index: 0,
            thinking: None,
            signature: Some("sig".into()),
        }]
    );

    assert_eq!(
        anthropic::anthropic_messages_stream_events(&json!({
            "type": "content_block_start",
            "index": 2,
            "content_block": { "type": "redacted_thinking", "data": "redacted" }
        })),
        vec![ProviderStreamEvent::AnthropicRedactedThinking {
            data: "redacted".into(),
        }]
    );

    assert_eq!(
        anthropic::anthropic_messages_stream_events(&json!({
            "type": "message_delta",
            "usage": {
                "input_tokens": 13,
                "cache_read_input_tokens": 6,
                "output_tokens": 8
            }
        })),
        vec![ProviderStreamEvent::Usage {
            input: 13,
            cached_input: 6,
            output: 8,
            reasoning_output: 0,
        }]
    );
}

#[test]
fn applies_provider_stream_events_to_accumulated_assistant_state() {
    let mut state = ProviderStreamState::default();

    apply_provider_stream_events(
        &mut state,
        &[
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Content,
                text: "hello ".into(),
            },
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Reasoning,
                text: "thinking ".into(),
            },
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 1,
                id: Some("call_1".into()),
                name: Some("read".into()),
                arguments: Some("{\"path\"".into()),
            }),
            ProviderStreamEvent::Usage {
                input: 7,
                cached_input: 2,
                output: 3,
                reasoning_output: 1,
            },
        ],
    );
    apply_provider_stream_events(
        &mut state,
        &[
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Content,
                text: "world".into(),
            },
            ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Reasoning,
                text: "done".into(),
            },
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 1,
                id: None,
                name: None,
                arguments: Some(":\"README.md\"}".into()),
            }),
        ],
    );

    assert_eq!(state.content, "hello world");
    assert_eq!(state.reasoning_content, Some("thinking done".into()));
    assert_eq!(state.usage.input, 7);
    assert_eq!(state.usage.cached_input, 2);
    assert_eq!(state.usage.output, 3);
    assert_eq!(state.usage.reasoning_output, 1);
    assert_eq!(state.tools.len(), 1);
    assert_eq!(state.tools[0].index, 1);
    assert_eq!(state.tools[0].id, Some("call_1".into()));
    assert_eq!(state.tools[0].name, Some("read".into()));
    assert_eq!(
        state.tools[0].arguments,
        Some("{\"path\":\"README.md\"}".into())
    );
}

#[test]
fn applies_provider_stream_tool_delta_by_ordered_index() {
    let mut state = ProviderStreamState::default();

    apply_provider_stream_events(
        &mut state,
        &[
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 2,
                id: Some("call_2".into()),
                name: Some("write".into()),
                arguments: Some("{\"path\"".into()),
            }),
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 0,
                id: Some("call_0".into()),
                name: Some("read".into()),
                arguments: Some("{\"path\":\"README.md\"}".into()),
            }),
            ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                index: 2,
                id: None,
                name: None,
                arguments: Some(":\"out.txt\"}".into()),
            }),
        ],
    );

    assert_eq!(state.tools.len(), 2);
    assert_eq!(state.tools[0].index, 0);
    assert_eq!(state.tools[0].name, Some("read".into()));
    assert_eq!(state.tools[1].index, 2);
    assert_eq!(state.tools[1].name, Some("write".into()));
    assert_eq!(
        state.tools[1].arguments,
        Some("{\"path\":\"out.txt\"}".into())
    );
}

#[test]
fn applies_provider_metadata_to_accumulated_assistant_state() {
    let mut state = ProviderStreamState::default();

    apply_provider_stream_events(
        &mut state,
        &[
            ProviderStreamEvent::OpenAiResponsesMetadata(ProviderOpenAiResponsesMetadata {
                reasoning_id: Some("rs_1".into()),
                encrypted_reasoning_content: Some("encrypted".into()),
                reasoning_text: Some("summary".into()),
            }),
            ProviderStreamEvent::AnthropicThinkingDelta {
                index: 0,
                thinking: Some("think ".into()),
                signature: None,
            },
            ProviderStreamEvent::AnthropicThinkingDelta {
                index: 0,
                thinking: Some("more".into()),
                signature: Some("sig".into()),
            },
            ProviderStreamEvent::AnthropicRedactedThinking {
                data: "redacted".into(),
            },
        ],
    );

    assert_eq!(state.reasoning_content, Some("summary".into()));
    assert_eq!(state.openai.reasoning_id, Some("rs_1".into()));
    assert_eq!(
        state.openai.encrypted_reasoning_content,
        Some("encrypted".into())
    );
    assert_eq!(
        state.anthropic.thinking_blocks,
        vec![
            AnthropicThinkingBlock::Thinking {
                index: 0,
                thinking: "think more".into(),
                signature: Some("sig".into()),
            },
            AnthropicThinkingBlock::RedactedThinking {
                data: "redacted".into(),
            },
        ]
    );
}
