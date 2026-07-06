use octofwen_llm::ir::{ContentPart, LlmIr, TokenUsage};
use octofwen_llm::lowering::lower_checkpointed_ir;

fn text(content: &str) -> Vec<ContentPart> {
    vec![ContentPart::Text {
        content: content.into(),
    }]
}

fn user(content: &str) -> LlmIr {
    LlmIr::User {
        content: text(content),
    }
}

fn assistant(content: &str) -> LlmIr {
    LlmIr::Assistant {
        content: content.into(),
        reasoning_content: None,
        usage: TokenUsage {
            cached_input: 0,
            uncached_input: 10,
            total_input: 10,
            output: 0,
        },
    }
}

fn checkpoint(summary: &str) -> LlmIr {
    LlmIr::Checkpoint {
        content: text(summary),
    }
}

#[test]
fn passes_through_messages_when_there_are_no_checkpoints() {
    let messages = vec![user("hello")];

    assert_eq!(lower_checkpointed_ir(&messages), Ok(messages));
}

#[test]
fn errors_when_a_trajectory_reaches_generic_lowering() {
    assert_eq!(
        lower_checkpointed_ir(&[LlmIr::Trajectory]).unwrap_err(),
        "Subagent trajectory entries cannot be lowered by checkpoint lowering"
    );
}

#[test]
fn keeps_a_single_checkpoint_and_following_messages() {
    let lowered = lower_checkpointed_ir(&[
        user("Hello"),
        assistant("Hi there"),
        checkpoint("Summary of early conversation"),
        user("How are you?"),
        assistant("I'm good"),
    ])
    .expect("checkpoint lowering should succeed");

    assert_eq!(
        lowered,
        vec![
            LlmIr::LoweredCheckpoint {
                content: text("Summary of early conversation")
            },
            user("How are you?"),
            assistant("I'm good"),
        ]
    );
}

#[test]
fn keeps_only_the_most_recent_checkpoint_and_following_messages() {
    let lowered = lower_checkpointed_ir(&[
        user("Message 1"),
        assistant("Response 1"),
        checkpoint("First checkpoint"),
        user("Message 2"),
        assistant("Response 2"),
        checkpoint("Second checkpoint"),
        user("Message 3"),
        assistant("Response 3"),
        checkpoint("Third checkpoint"),
        user("Message 4"),
        assistant("Response 4"),
    ])
    .expect("checkpoint lowering should succeed");

    assert_eq!(
        lowered,
        vec![
            LlmIr::LoweredCheckpoint {
                content: text("Third checkpoint")
            },
            user("Message 4"),
            assistant("Response 4"),
        ]
    );
}

#[test]
fn keeps_the_checkpoint_when_the_checkpoint_is_at_the_end() {
    let lowered = lower_checkpointed_ir(&[
        user("Message 1"),
        assistant("Response 1"),
        checkpoint("Latest checkpoint"),
    ])
    .expect("checkpoint lowering should succeed");

    assert_eq!(
        lowered,
        vec![LlmIr::LoweredCheckpoint {
            content: text("Latest checkpoint")
        }]
    );
}
