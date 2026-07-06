use octofwen_agent::trajectory::{TrajectoryEvent, TrajectoryOutputIr, buffered_assistant_irs};
use octofwen_llm::compiler::CompilerTokenBuffer;
use octofwen_llm::ir::{LlmIr, TokenUsage};

#[test]
fn buffered_assistant_irs_returns_empty_without_buffered_tokens() {
    assert_eq!(
        buffered_assistant_irs(Vec::new(), &CompilerTokenBuffer::default()),
        Vec::new()
    );
}

#[test]
fn buffered_assistant_irs_appends_assistant_with_zero_usage_when_tokens_exist() {
    let mut buffer = CompilerTokenBuffer::default();
    buffer.content = "partial answer".to_string();
    buffer.reasoning = "thinking".to_string();
    buffer.tool = "tool-json".to_string();

    let prior = vec![TrajectoryOutputIr::Llm(LlmIr::User {
        content: Vec::new(),
    })];
    let irs = buffered_assistant_irs(prior.clone(), &buffer);

    assert_eq!(
        irs,
        vec![
            prior[0].clone(),
            TrajectoryOutputIr::Llm(LlmIr::Assistant {
                content: "partial answer".to_string(),
                reasoning_content: Some("thinking".to_string()),
                usage: TokenUsage {
                    cached_input: 0,
                    uncached_input: 0,
                    total_input: 0,
                    output: 0,
                },
            })
        ]
    );
}

#[test]
fn buffered_assistant_irs_uses_empty_content_and_no_reasoning_when_only_tool_tokens_exist() {
    let mut buffer = CompilerTokenBuffer::default();
    buffer.tool = "tool-json".to_string();

    assert_eq!(
        buffered_assistant_irs(Vec::new(), &buffer),
        vec![TrajectoryOutputIr::Llm(LlmIr::Assistant {
            content: String::new(),
            reasoning_content: None,
            usage: TokenUsage {
                cached_input: 0,
                uncached_input: 0,
                total_input: 0,
                output: 0,
            },
        })]
    );
}

use octofwen_agent::trajectory::{ResponseTokenDelta, append_response_token_progress};
use octofwen_llm::compiler::CompilerTokenType;

#[test]
fn response_token_progress_updates_buffer_and_returns_progress_event() {
    let mut buffer = CompilerTokenBuffer::default();
    let event = append_response_token_progress(&mut buffer, CompilerTokenType::Content, "hello");

    assert_eq!(buffer.content, "hello");
    assert_eq!(
        event,
        TrajectoryEvent::ResponseProgress {
            buffer: buffer.clone(),
            delta: ResponseTokenDelta {
                token_type: CompilerTokenType::Content,
                value: "hello".to_string(),
            },
        }
    );
}

#[test]
fn response_token_progress_tracks_reasoning_and_tool_tokens() {
    let mut buffer = CompilerTokenBuffer::default();

    let reasoning =
        append_response_token_progress(&mut buffer, CompilerTokenType::Reasoning, "why");
    let tool = append_response_token_progress(&mut buffer, CompilerTokenType::Tool, "{json}");

    assert_eq!(buffer.reasoning, "why");
    assert_eq!(buffer.tool, "{json}");
    assert_eq!(
        reasoning,
        TrajectoryEvent::ResponseProgress {
            buffer: CompilerTokenBuffer {
                reasoning: "why".to_string(),
                content: String::new(),
                tool: String::new(),
                unexpected_tool_call: false,
            },
            delta: ResponseTokenDelta {
                token_type: CompilerTokenType::Reasoning,
                value: "why".to_string(),
            },
        }
    );
    assert_eq!(
        tool,
        TrajectoryEvent::ResponseProgress {
            buffer,
            delta: ResponseTokenDelta {
                token_type: CompilerTokenType::Tool,
                value: "{json}".to_string(),
            },
        }
    );
}
