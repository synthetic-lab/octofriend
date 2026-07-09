use octofwen_models::compiler::{
    AssistantOutputProvider, AssistantOutputRequest, build_assistant_output,
};
use octofwen_models::providers::stream::{
    AnthropicThinkingBlock, GeminiThoughtSignature, ProviderAnthropicState, ProviderGeminiState,
    ProviderOpenAiState, ProviderStreamState, ProviderStreamUsage,
};
use serde_json::json;

#[test]
fn builds_openai_responses_assistant_output_with_usage_and_metadata() {
    let result = build_assistant_output(&AssistantOutputRequest {
        provider: AssistantOutputProvider::OpenAiResponses,
        state: ProviderStreamState {
            content: "answer".into(),
            reasoning_content: Some("thinking".into()),
            usage: ProviderStreamUsage {
                input: 12,
                cached_input: 5,
                output: 8,
                reasoning_output: 2,
            },
            openai: ProviderOpenAiState {
                reasoning_id: Some("rs_1".into()),
                encrypted_reasoning_content: Some("encrypted".into()),
            },
            anthropic: ProviderAnthropicState::default(),
            gemini: ProviderGeminiState::default(),
            tools: Vec::new(),
        },
    });

    assert_eq!(
        result.usage,
        json!({
            "input": { "cached": 5, "uncached": 7, "total": 12 },
            "output": 8,
        })
    );
    assert_eq!(
        result.output,
        json!({
            "role": "assistant",
            "content": "answer",
            "reasoningContent": "thinking",
            "usage": result.usage,
            "openai": {
                "reasoningId": "rs_1",
                "encryptedReasoningContent": "encrypted"
            }
        })
    );
}

#[test]
fn builds_anthropic_assistant_output_with_thinking_blocks() {
    let result = build_assistant_output(&AssistantOutputRequest {
        provider: AssistantOutputProvider::Anthropic,
        state: ProviderStreamState {
            content: "answer".into(),
            reasoning_content: None,
            usage: ProviderStreamUsage {
                input: 1,
                cached_input: 0,
                output: 2,
                reasoning_output: 0,
            },
            openai: ProviderOpenAiState::default(),
            anthropic: ProviderAnthropicState {
                thinking_blocks: vec![
                    AnthropicThinkingBlock::Thinking {
                        index: 0,
                        thinking: "internal".into(),
                        signature: None,
                    },
                    AnthropicThinkingBlock::RedactedThinking {
                        data: "blob".into(),
                    },
                ],
            },
            gemini: ProviderGeminiState::default(),
            tools: Vec::new(),
        },
    });

    assert_eq!(
        result.output,
        json!({
            "role": "assistant",
            "content": "answer",
            "usage": {
                "input": { "cached": 0, "uncached": 1, "total": 1 },
                "output": 2,
            },
            "anthropic": {
                "thinkingBlocks": [
                    { "type": "thinking", "signature": "", "thinking": "internal" },
                    { "type": "redacted_thinking", "data": "blob" }
                ]
            }
        })
    );
}

#[test]
fn builds_gemini_assistant_output_with_thought_signatures() {
    let result = build_assistant_output(&AssistantOutputRequest {
        provider: AssistantOutputProvider::Gemini,
        state: ProviderStreamState {
            content: "answer".into(),
            reasoning_content: None,
            usage: ProviderStreamUsage {
                input: 1,
                cached_input: 0,
                output: 2,
                reasoning_output: 0,
            },
            openai: ProviderOpenAiState::default(),
            anthropic: ProviderAnthropicState::default(),
            gemini: ProviderGeminiState {
                thought_signatures: vec![GeminiThoughtSignature {
                    part_index: 0,
                    tool_call_id: Some("call-1".into()),
                    thought_signature: "sig-1".into(),
                }],
            },
            tools: Vec::new(),
        },
    });

    assert_eq!(
        result.output,
        json!({
            "role": "assistant",
            "content": "answer",
            "usage": {
                "input": { "cached": 0, "uncached": 1, "total": 1 },
                "output": 2,
            },
            "gemini": {
                "thoughtSignatures": [{
                    "partIndex": 0,
                    "toolCallId": "call-1",
                    "thoughtSignature": "sig-1"
                }]
            }
        })
    );
}
