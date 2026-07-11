use octofriend_models::providers::stream::{
    AnthropicThinkingBlock, GeminiThoughtSignature, ProviderStreamEvent, ProviderStreamState,
    ProviderStreamTool, ProviderTokenKind,
};
use serde_json::{Value, json};

pub(in crate::runtime) fn provider_stream_events_json(events: &[ProviderStreamEvent]) -> Value {
    Value::Array(events.iter().map(provider_stream_event_json).collect())
}

fn provider_stream_event_json(event: &ProviderStreamEvent) -> Value {
    match event {
        ProviderStreamEvent::Token { kind, text } => json!({
            "type": "token",
            "kind": provider_token_kind_json(kind),
            "text": text,
        }),
        ProviderStreamEvent::ToolDelta(delta) => json!({
            "type": "tool-delta",
            "index": delta.index,
            "id": delta.id,
            "name": delta.name,
            "arguments": delta.arguments,
        }),
        ProviderStreamEvent::Usage {
            input,
            cached_input,
            output,
            reasoning_output,
        } => json!({
            "type": "usage",
            "input": input,
            "cachedInput": cached_input,
            "output": output,
            "reasoningOutput": reasoning_output,
        }),
        ProviderStreamEvent::OpenAiResponsesMetadata(metadata) => json!({
            "type": "openai-responses-metadata",
            "reasoningId": metadata.reasoning_id,
            "encryptedReasoningContent": metadata.encrypted_reasoning_content,
            "reasoningText": metadata.reasoning_text,
        }),
        ProviderStreamEvent::GeminiThoughtSignature(signature) => json!({
            "type": "gemini-thought-signature",
            "partIndex": signature.part_index,
            "toolCallId": signature.tool_call_id,
            "thoughtSignature": signature.thought_signature,
        }),
        ProviderStreamEvent::AnthropicThinkingDelta {
            index,
            thinking,
            signature,
        } => json!({
            "type": "anthropic-thinking-delta",
            "index": index,
            "thinking": thinking,
            "signature": signature,
        }),
        ProviderStreamEvent::AnthropicRedactedThinking { data } => json!({
            "type": "anthropic-redacted-thinking",
            "data": data,
        }),
    }
}

fn provider_token_kind_json(kind: &ProviderTokenKind) -> &'static str {
    match kind {
        ProviderTokenKind::Content => "content",
        ProviderTokenKind::Reasoning => "reasoning",
        ProviderTokenKind::Tool => "tool",
    }
}

pub(in crate::runtime) fn provider_stream_state_json(state: &ProviderStreamState) -> Value {
    json!({
        "content": state.content,
        "reasoningContent": state.reasoning_content,
        "usage": {
            "input": state.usage.input,
            "cachedInput": state.usage.cached_input,
            "output": state.usage.output,
            "reasoningOutput": state.usage.reasoning_output,
        },
        "tools": state.tools.iter().map(provider_stream_tool_json).collect::<Vec<_>>(),
        "openai": {
            "reasoningId": state.openai.reasoning_id,
            "encryptedReasoningContent": state.openai.encrypted_reasoning_content,
        },
        "anthropic": {
            "thinkingBlocks": state
                .anthropic
                .thinking_blocks
                .iter()
                .map(anthropic_thinking_block_json)
                .collect::<Vec<_>>(),
        },
        "gemini": {
            "thoughtSignatures": state
                .gemini
                .thought_signatures
                .iter()
                .map(gemini_thought_signature_json)
                .collect::<Vec<_>>(),
        },
    })
}

fn gemini_thought_signature_json(signature: &GeminiThoughtSignature) -> Value {
    json!({
        "partIndex": signature.part_index,
        "toolCallId": signature.tool_call_id,
        "thoughtSignature": signature.thought_signature,
    })
}

fn anthropic_thinking_block_json(block: &AnthropicThinkingBlock) -> Value {
    match block {
        AnthropicThinkingBlock::Thinking {
            index,
            thinking,
            signature,
        } => json!({
            "type": "thinking",
            "index": index,
            "thinking": thinking,
            "signature": signature,
        }),
        AnthropicThinkingBlock::RedactedThinking { data } => json!({
            "type": "redacted_thinking",
            "data": data,
        }),
    }
}

fn provider_stream_tool_json(tool: &ProviderStreamTool) -> Value {
    json!({
        "index": tool.index,
        "id": tool.id,
        "name": tool.name,
        "arguments": tool.arguments,
    })
}
