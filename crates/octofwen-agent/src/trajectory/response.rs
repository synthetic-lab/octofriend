use super::{TrajectoryEvent, TrajectoryOutputIr};
use octofwen_llm::compiler::{CompilerTokenBuffer, CompilerTokenType};
use octofwen_llm::ir::{LlmIr, TokenUsage};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResponseTokenDelta {
    pub token_type: CompilerTokenType,
    pub value: String,
}

pub fn append_response_token_progress(
    buffer: &mut CompilerTokenBuffer,
    token_type: CompilerTokenType,
    value: &str,
) -> TrajectoryEvent {
    buffer.push(token_type, value, true);
    TrajectoryEvent::ResponseProgress {
        buffer: buffer.clone(),
        delta: ResponseTokenDelta {
            token_type,
            value: value.to_string(),
        },
    }
}

pub fn buffered_assistant_irs(
    mut irs: Vec<TrajectoryOutputIr>,
    buffer: &CompilerTokenBuffer,
) -> Vec<TrajectoryOutputIr> {
    if buffer.content.is_empty() && buffer.reasoning.is_empty() && buffer.tool.is_empty() {
        return Vec::new();
    }

    irs.push(TrajectoryOutputIr::Llm(LlmIr::Assistant {
        content: buffer.content.clone(),
        reasoning_content: (!buffer.reasoning.is_empty()).then(|| buffer.reasoning.clone()),
        usage: TokenUsage {
            cached_input: 0,
            uncached_input: 0,
            total_input: 0,
            output: 0,
        },
    }));
    irs
}
