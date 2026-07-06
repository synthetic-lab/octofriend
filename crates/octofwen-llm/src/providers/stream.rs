#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProviderTokenKind {
    Content,
    Reasoning,
    Tool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderToolDelta {
    pub index: u64,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GeminiThoughtSignature {
    pub part_index: u64,
    pub tool_call_id: Option<String>,
    pub thought_signature: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderOpenAiResponsesMetadata {
    pub reasoning_id: Option<String>,
    pub encrypted_reasoning_content: Option<String>,
    pub reasoning_text: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProviderStreamEvent {
    Token {
        kind: ProviderTokenKind,
        text: String,
    },
    ToolDelta(ProviderToolDelta),
    Usage {
        input: u64,
        cached_input: u64,
        output: u64,
        reasoning_output: u64,
    },
    OpenAiResponsesMetadata(ProviderOpenAiResponsesMetadata),
    GeminiThoughtSignature(GeminiThoughtSignature),
    AnthropicThinkingDelta {
        index: u64,
        thinking: Option<String>,
        signature: Option<String>,
    },
    AnthropicRedactedThinking {
        data: String,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProviderStreamUsage {
    pub input: u64,
    pub cached_input: u64,
    pub output: u64,
    pub reasoning_output: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderStreamTool {
    pub index: u64,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProviderOpenAiState {
    pub reasoning_id: Option<String>,
    pub encrypted_reasoning_content: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AnthropicThinkingBlock {
    Thinking {
        index: u64,
        thinking: String,
        signature: Option<String>,
    },
    RedactedThinking {
        data: String,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProviderAnthropicState {
    pub thinking_blocks: Vec<AnthropicThinkingBlock>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProviderGeminiState {
    pub thought_signatures: Vec<GeminiThoughtSignature>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProviderStreamState {
    pub content: String,
    pub reasoning_content: Option<String>,
    pub usage: ProviderStreamUsage,
    pub tools: Vec<ProviderStreamTool>,
    pub openai: ProviderOpenAiState,
    pub anthropic: ProviderAnthropicState,
    pub gemini: ProviderGeminiState,
}

pub fn apply_provider_stream_events(
    state: &mut ProviderStreamState,
    events: &[ProviderStreamEvent],
) {
    for event in events {
        match event {
            ProviderStreamEvent::Token { kind, text } => {
                apply_provider_stream_token(state, kind, text);
            }
            ProviderStreamEvent::ToolDelta(delta) => {
                apply_provider_stream_tool_delta(state, delta);
            }
            ProviderStreamEvent::Usage {
                input,
                cached_input,
                output,
                reasoning_output,
            } => {
                state.usage.input = *input;
                state.usage.cached_input = *cached_input;
                state.usage.output = *output;
                state.usage.reasoning_output = *reasoning_output;
            }
            ProviderStreamEvent::OpenAiResponsesMetadata(metadata) => {
                apply_openai_responses_metadata(state, metadata);
            }
            ProviderStreamEvent::GeminiThoughtSignature(signature) => {
                apply_gemini_thought_signature(state, signature);
            }
            ProviderStreamEvent::AnthropicThinkingDelta {
                index,
                thinking,
                signature,
            } => {
                apply_anthropic_thinking_delta(state, *index, thinking, signature);
            }
            ProviderStreamEvent::AnthropicRedactedThinking { data } => {
                state
                    .anthropic
                    .thinking_blocks
                    .push(AnthropicThinkingBlock::RedactedThinking { data: data.clone() });
            }
        }
    }
}

fn apply_provider_stream_token(
    state: &mut ProviderStreamState,
    kind: &ProviderTokenKind,
    text: &str,
) {
    match kind {
        ProviderTokenKind::Content => state.content.push_str(text),
        ProviderTokenKind::Reasoning => {
            state
                .reasoning_content
                .get_or_insert_with(String::new)
                .push_str(text);
        }
        ProviderTokenKind::Tool => {}
    }
}

fn apply_provider_stream_tool_delta(state: &mut ProviderStreamState, delta: &ProviderToolDelta) {
    let tool_index = match existing_tool_delta_index(state, delta) {
        Some(index) => index,
        None => {
            state.tools.push(ProviderStreamTool {
                index: delta.index,
                id: None,
                name: None,
                arguments: None,
            });
            state.tools.len() - 1
        }
    };
    let tool = &mut state.tools[tool_index];
    if let Some(id) = &delta.id {
        tool.id = Some(id.clone());
    }
    if let Some(name) = &delta.name {
        tool.name = Some(name.clone());
    }
    if let Some(arguments) = &delta.arguments {
        tool.arguments
            .get_or_insert_with(String::new)
            .push_str(arguments);
    }
    state.tools.sort_by_key(|tool| tool.index);
}

fn existing_tool_delta_index(
    state: &ProviderStreamState,
    delta: &ProviderToolDelta,
) -> Option<usize> {
    if let Some(id) = &delta.id {
        return state
            .tools
            .iter()
            .position(|tool| tool.id.as_ref() == Some(id));
    }

    state
        .tools
        .iter()
        .position(|tool| tool.index == delta.index)
}

fn apply_openai_responses_metadata(
    state: &mut ProviderStreamState,
    metadata: &ProviderOpenAiResponsesMetadata,
) {
    if let Some(reasoning_id) = &metadata.reasoning_id {
        state.openai.reasoning_id = Some(reasoning_id.clone());
    }
    if let Some(encrypted_reasoning_content) = &metadata.encrypted_reasoning_content {
        state.openai.encrypted_reasoning_content = Some(encrypted_reasoning_content.clone());
    }
    if state.reasoning_content.is_none()
        && let Some(reasoning_text) = &metadata.reasoning_text
        && !reasoning_text.is_empty()
    {
        state.reasoning_content = Some(reasoning_text.clone());
    }
}

fn apply_gemini_thought_signature(
    state: &mut ProviderStreamState,
    signature: &GeminiThoughtSignature,
) {
    state.gemini.thought_signatures.push(signature.clone());
}

fn apply_anthropic_thinking_delta(
    state: &mut ProviderStreamState,
    index: u64,
    thinking: &Option<String>,
    signature: &Option<String>,
) {
    let block_index = state
        .anthropic
        .thinking_blocks
        .iter()
        .position(|block| matches!(block, AnthropicThinkingBlock::Thinking { index: existing, .. } if *existing == index));
    let block_index = match block_index {
        Some(block_index) => block_index,
        None => {
            state
                .anthropic
                .thinking_blocks
                .push(AnthropicThinkingBlock::Thinking {
                    index,
                    thinking: String::new(),
                    signature: None,
                });
            state.anthropic.thinking_blocks.len() - 1
        }
    };
    let AnthropicThinkingBlock::Thinking {
        thinking: block_thinking,
        signature: block_signature,
        ..
    } = &mut state.anthropic.thinking_blocks[block_index]
    else {
        return;
    };
    if let Some(thinking) = thinking {
        block_thinking.push_str(thinking);
    }
    if let Some(signature) = signature {
        *block_signature = Some(signature.clone());
    }
}
