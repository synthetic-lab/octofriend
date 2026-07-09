use octofwen_agent::run_events::{
    TrajectoryEvent, TrajectoryFinishReason, TrajectoryOutputIr, apply_compaction_checkpoint,
    approximate_ir_tokens, compaction_checkpoint_content, compaction_request_messages,
    compiler_error_to_compaction_finish_reason, process_compacted_history,
    should_auto_compact_history,
};
use octofwen_models::compiler::CompilerError;
use octofwen_models::request_ir::{ContentPart, LlmIr, TokenUsage};

fn assistant(content: &str, total_input: u64, output: u64) -> LlmIr {
    LlmIr::Assistant {
        content: content.to_string(),
        reasoning_content: None,
        usage: TokenUsage {
            cached_input: 0,
            uncached_input: total_input,
            total_input,
            output,
        },
    }
}

fn text_user(content: &str) -> LlmIr {
    LlmIr::User {
        content: vec![ContentPart::Text {
            content: content.to_string(),
        }],
    }
}

#[test]
fn auto_compaction_uses_most_recent_assistant_usage_plus_trailing_text() {
    let messages = vec![
        assistant("old", 100, 100),
        assistant("checkpoint", 89, 0),
        text_user("hello"),
    ];

    assert_eq!(approximate_ir_tokens(&messages), 91);
    assert!(should_auto_compact_history(100, &messages));
    assert!(!should_auto_compact_history(200, &messages));
}

#[test]
fn compaction_checkpoint_is_appended_to_output_and_reported_as_event() {
    let checkpoint_content = vec![ContentPart::Text {
        content: "summary".to_string(),
    }];
    let finish = apply_compaction_checkpoint(Vec::new(), checkpoint_content.clone());

    assert_eq!(
        finish.irs,
        vec![TrajectoryOutputIr::Llm(LlmIr::Checkpoint {
            content: checkpoint_content.clone(),
        })]
    );
    assert_eq!(
        finish.events,
        vec![TrajectoryEvent::CompactionParsed {
            checkpoint: LlmIr::Checkpoint {
                content: checkpoint_content,
            },
        }]
    );
}

#[test]
fn compacted_history_processing_prefers_content_and_falls_back_to_reasoning() {
    let content_summary = LlmIr::Assistant {
        content: "summary".to_string(),
        reasoning_content: Some("reasoned summary".to_string()),
        usage: TokenUsage {
            cached_input: 0,
            uncached_input: 0,
            total_input: 0,
            output: 0,
        },
    };
    let reasoning_summary = LlmIr::Assistant {
        content: String::new(),
        reasoning_content: Some("reasoned summary".to_string()),
        usage: TokenUsage {
            cached_input: 0,
            uncached_input: 0,
            total_input: 0,
            output: 0,
        },
    };

    assert_eq!(process_compacted_history(&content_summary), Some("summary"));
    assert_eq!(
        process_compacted_history(&reasoning_summary),
        Some("reasoned summary")
    );
}

#[test]
fn compaction_checkpoint_content_wraps_non_empty_summary() {
    let checkpoint_content = compaction_checkpoint_content("short summary").unwrap();
    let text = checkpoint_content
        .iter()
        .map(|part| match part {
            ContentPart::Text { content } => content.as_str(),
            ContentPart::Image { .. } => "",
        })
        .collect::<String>();

    assert!(text.contains("Conversation History Summary"));
    assert!(text.contains("short summary"));
    assert!(text.contains("Context Has Been Compacted"));
}

#[test]
fn compaction_checkpoint_content_rejects_empty_summaries() {
    assert_eq!(compaction_checkpoint_content(""), None);
}

#[test]
fn compaction_request_messages_append_prompt_as_user_message() {
    let original = vec![text_user("work")];
    let request_messages = compaction_request_messages(&original);

    assert_eq!(request_messages.len(), 2);
    assert_eq!(request_messages[0], original[0]);

    let LlmIr::User { content } = &request_messages[1] else {
        panic!("compaction prompt must be appended as a user message");
    };
    assert_eq!(content.len(), 1);
    let ContentPart::Text { content } = &content[0] else {
        panic!("compaction prompt must be text content");
    };
    assert!(content.contains("Generate a summary"));
    assert!(content.contains("<summary>"));
}

#[test]
fn compaction_compiler_payment_and_rate_limit_errors_remain_recoverable() {
    assert_eq!(
        compiler_error_to_compaction_finish_reason(CompilerError::Payment {
            request_error: "buy credits".to_string(),
            curl: "curl payment".to_string(),
        }),
        TrajectoryFinishReason::PaymentError {
            request_error: "buy credits".to_string(),
            curl: "curl payment".to_string(),
        }
    );

    assert_eq!(
        compiler_error_to_compaction_finish_reason(CompilerError::RateLimit {
            request_error: "slow down".to_string(),
            curl: "curl rate".to_string(),
        }),
        TrajectoryFinishReason::RateLimitError {
            request_error: "slow down".to_string(),
            curl: "curl rate".to_string(),
        }
    );
}

#[test]
fn compaction_compiler_request_like_errors_become_compaction_errors() {
    assert_eq!(
        compiler_error_to_compaction_finish_reason(CompilerError::Request {
            request_error: "network down".to_string(),
            curl: "curl request".to_string(),
        }),
        TrajectoryFinishReason::CompactionError {
            request_error: "network down".to_string(),
            curl: Some("curl request".to_string()),
        }
    );
}

use octofwen_agent::run_events::{CompactionTokenDelta, append_compaction_token_progress};
use octofwen_models::compiler::{CompilerTokenBuffer, CompilerTokenType};

#[test]
fn compaction_token_progress_updates_buffer_and_returns_stream_event() {
    let mut buffer = CompilerTokenBuffer::default();
    let event =
        append_compaction_token_progress(&mut buffer, CompilerTokenType::Content, "summary");

    assert_eq!(buffer.content, "summary");
    assert_eq!(
        event,
        TrajectoryEvent::CompactionProgress {
            buffer: buffer.clone(),
            delta: CompactionTokenDelta {
                token_type: CompilerTokenType::Content,
                value: "summary".to_string(),
            },
        }
    );
}

#[test]
fn compaction_token_progress_tracks_reasoning_tokens() {
    let mut buffer = CompilerTokenBuffer::default();
    let event =
        append_compaction_token_progress(&mut buffer, CompilerTokenType::Reasoning, "thinking");

    assert_eq!(buffer.reasoning, "thinking");
    assert_eq!(buffer.tool, "");
    assert_eq!(
        event,
        TrajectoryEvent::CompactionProgress {
            buffer,
            delta: CompactionTokenDelta {
                token_type: CompilerTokenType::Reasoning,
                value: "thinking".to_string(),
            },
        }
    );
}
