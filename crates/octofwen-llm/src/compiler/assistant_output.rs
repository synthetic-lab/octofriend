use crate::providers::stream::{
    AnthropicThinkingBlock, GeminiThoughtSignature, ProviderStreamState,
};
use serde_json::{Map, Value, json};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssistantOutputProvider {
    OpenAiChatCompletions,
    OpenAiResponses,
    Anthropic,
    Gemini,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssistantOutputRequest {
    pub provider: AssistantOutputProvider,
    pub state: ProviderStreamState,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AssistantOutputResult {
    pub output: Value,
    pub usage: Value,
}

pub fn build_assistant_output(request: &AssistantOutputRequest) -> AssistantOutputResult {
    let usage = compiler_usage_json(&request.state);
    let mut output = Map::new();
    output.insert("role".into(), json!("assistant"));
    output.insert("content".into(), json!(request.state.content));
    if let Some(reasoning_content) = &request.state.reasoning_content {
        output.insert("reasoningContent".into(), json!(reasoning_content));
    }
    output.insert("usage".into(), usage.clone());

    match request.provider {
        AssistantOutputProvider::OpenAiChatCompletions => {}
        AssistantOutputProvider::OpenAiResponses => {
            append_openai_metadata(&mut output, &request.state)
        }
        AssistantOutputProvider::Anthropic => {
            append_anthropic_metadata(&mut output, &request.state)
        }
        AssistantOutputProvider::Gemini => append_gemini_metadata(&mut output, &request.state),
    }

    AssistantOutputResult {
        output: Value::Object(output),
        usage,
    }
}

fn compiler_usage_json(state: &ProviderStreamState) -> Value {
    let uncached = state.usage.input.saturating_sub(state.usage.cached_input);
    json!({
        "input": {
            "cached": state.usage.cached_input,
            "uncached": uncached,
            "total": state.usage.input,
        },
        "output": state.usage.output,
    })
}

fn append_openai_metadata(output: &mut Map<String, Value>, state: &ProviderStreamState) {
    if state.openai.reasoning_id.is_none() && state.openai.encrypted_reasoning_content.is_none() {
        return;
    }
    output.insert(
        "openai".into(),
        json!({
            "reasoningId": state.openai.reasoning_id,
            "encryptedReasoningContent": state.openai.encrypted_reasoning_content,
        }),
    );
}

fn append_anthropic_metadata(output: &mut Map<String, Value>, state: &ProviderStreamState) {
    if state.anthropic.thinking_blocks.is_empty() {
        return;
    }
    output.insert(
        "anthropic".into(),
        json!({
            "thinkingBlocks": state.anthropic.thinking_blocks.iter().map(anthropic_thinking_block_json).collect::<Vec<_>>(),
        }),
    );
}

fn append_gemini_metadata(output: &mut Map<String, Value>, state: &ProviderStreamState) {
    if state.gemini.thought_signatures.is_empty() {
        return;
    }
    output.insert(
        "gemini".into(),
        json!({
            "thoughtSignatures": state.gemini.thought_signatures.iter().map(gemini_thought_signature_json).collect::<Vec<_>>(),
        }),
    );
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
            thinking,
            signature,
            ..
        } => json!({
            "type": "thinking",
            "signature": signature.clone().unwrap_or_default(),
            "thinking": thinking,
        }),
        AnthropicThinkingBlock::RedactedThinking { data } => json!({
            "type": "redacted_thinking",
            "data": data,
        }),
    }
}
