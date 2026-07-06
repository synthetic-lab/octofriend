use super::{TrajectoryEvent, TrajectoryFinish, TrajectoryFinishReason, TrajectoryOutputIr};
use octofwen_core::text::estimate_tokens;
use octofwen_llm::compiler::{CompilerError, CompilerTokenBuffer, CompilerTokenType};
use octofwen_llm::ir::{ContentPart, LlmIr};
use octofwen_llm::prompts::compaction_prompt;

const AUTOCOMPACT_THRESHOLD: f64 = 0.9;

const COMPACTION_CHECKPOINT_PREFIX: &str = "# Conversation History Summary\n\nThe following text is a condensed summary of all previous messages in this conversation:\n\n";

const COMPACTION_CHECKPOINT_SUFFIX: &str = "\n\n---\n\n## IMPORTANT: Context Has Been Compacted\n\nThe individual messages from earlier in this conversation are no longer available. They have been compressed into the summary text above to save tokens.\n\n**Your instructions:**\n1. Read the summary text above - it contains all the information from the previous messages\n2. Treat the summary as your complete reference for what happened earlier in this conversation\n3. Continue working on your current task exactly where you left off\n\nResume your work now.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompactionTokenDelta {
    pub token_type: CompilerTokenType,
    pub value: String,
}

pub fn append_compaction_token_progress(
    buffer: &mut CompilerTokenBuffer,
    token_type: CompilerTokenType,
    value: &str,
) -> TrajectoryEvent {
    buffer.push(token_type, value, true);
    TrajectoryEvent::CompactionProgress {
        buffer: buffer.clone(),
        delta: CompactionTokenDelta {
            token_type,
            value: value.to_string(),
        },
    }
}

pub fn should_auto_compact_history(max_context_window: usize, messages: &[LlmIr]) -> bool {
    let max_allowed_tokens = ((max_context_window as f64) * AUTOCOMPACT_THRESHOLD).floor() as usize;
    let current_tokens = approximate_ir_tokens(messages);

    current_tokens >= max_allowed_tokens
}

pub fn approximate_ir_tokens(ir: &[LlmIr]) -> usize {
    let most_recent_assistant_index = ir
        .iter()
        .rposition(|message| matches!(message, LlmIr::Assistant { .. }));

    let checkpoint_token_count = most_recent_assistant_index
        .and_then(|index| match &ir[index] {
            LlmIr::Assistant { usage, .. } => Some((usage.total_input + usage.output) as usize),
            _ => None,
        })
        .unwrap_or(0);

    let trailing_start = most_recent_assistant_index.map_or(0, |index| index + 1);
    let trailing_token_count = ir[trailing_start..]
        .iter()
        .map(|message| estimate_tokens(&message_text(message)))
        .sum::<usize>();

    checkpoint_token_count + trailing_token_count
}

pub fn compiler_error_to_compaction_finish_reason(error: CompilerError) -> TrajectoryFinishReason {
    match error {
        CompilerError::Payment {
            request_error,
            curl,
        } => TrajectoryFinishReason::PaymentError {
            request_error,
            curl,
        },
        CompilerError::RateLimit {
            request_error,
            curl,
        } => TrajectoryFinishReason::RateLimitError {
            request_error,
            curl,
        },
        CompilerError::Request {
            request_error,
            curl,
        }
        | CompilerError::Stream {
            request_error,
            curl,
            usage: _,
        }
        | CompilerError::UnexpectedToolCall {
            request_error,
            curl,
            usage: _,
        } => TrajectoryFinishReason::CompactionError {
            request_error,
            curl: Some(curl),
        },
    }
}

pub fn compaction_request_messages(messages: &[LlmIr]) -> Vec<LlmIr> {
    let mut request_messages = messages.to_vec();
    request_messages.push(LlmIr::User {
        content: vec![ContentPart::Text {
            content: compaction_prompt(),
        }],
    });
    request_messages
}

pub fn process_compacted_history(message: &LlmIr) -> Option<&str> {
    let LlmIr::Assistant {
        content,
        reasoning_content,
        ..
    } = message
    else {
        return None;
    };

    if !content.is_empty() {
        return Some(content);
    }

    reasoning_content
        .as_deref()
        .filter(|reasoning| !reasoning.is_empty())
}

pub fn compaction_checkpoint_content(summary: &str) -> Option<Vec<ContentPart>> {
    if summary.is_empty() {
        return None;
    }

    Some(vec![
        ContentPart::Text {
            content: COMPACTION_CHECKPOINT_PREFIX.to_string(),
        },
        ContentPart::Text {
            content: summary.to_string(),
        },
        ContentPart::Text {
            content: COMPACTION_CHECKPOINT_SUFFIX.to_string(),
        },
    ])
}

pub fn apply_compaction_checkpoint(
    mut irs: Vec<TrajectoryOutputIr>,
    content: Vec<ContentPart>,
) -> TrajectoryFinish {
    let checkpoint = LlmIr::Checkpoint { content };
    irs.push(TrajectoryOutputIr::Llm(checkpoint.clone()));

    TrajectoryFinish {
        irs,
        reason: TrajectoryFinishReason::NeedsResponse,
        events: vec![TrajectoryEvent::CompactionParsed { checkpoint }],
    }
}

fn message_text(message: &LlmIr) -> String {
    match message {
        LlmIr::Assistant {
            content,
            reasoning_content,
            ..
        } => format!("{}{}", content, reasoning_content.as_deref().unwrap_or("")),
        LlmIr::User { content }
        | LlmIr::Checkpoint { content }
        | LlmIr::LoweredCheckpoint { content }
        | LlmIr::ToolOutput { content, .. } => content_text(content),
        LlmIr::ToolSkipOutput { reason, .. } => reason.clone(),
        LlmIr::FileRead { path, content, .. } | LlmIr::FileMutate { path, content, .. } => {
            format!("{path}\n{content}")
        }
        LlmIr::ToolReject { tool_call } => format!("{}{}", tool_call.original, tool_call.parsed),
        LlmIr::Trajectory => String::new(),
    }
}

fn content_text(content: &[ContentPart]) -> String {
    content
        .iter()
        .map(|part| match part {
            ContentPart::Text { content } => content.clone(),
            ContentPart::Image { image } => format!("Image file: {}", image.file_path),
        })
        .collect::<Vec<_>>()
        .join("\n")
}
