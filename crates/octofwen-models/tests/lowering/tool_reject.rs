use octofwen_models::lowering::{lower_octo_ir, lower_tool_rejects};
use octofwen_models::request_ir::{ContentPart, LlmIr, ToolCall};
use serde_json::json;

fn user(content: &str) -> LlmIr {
    LlmIr::User {
        content: vec![ContentPart::Text {
            content: content.into(),
        }],
    }
}

fn tool_call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        tool_call_id: id.into(),
        name: name.into(),
        original: json!({}),
        parsed: json!({}),
    }
}

#[test]
fn lowers_rejected_tool_calls_into_skipped_tool_outputs() {
    let call = tool_call("call-1", "read");

    assert_eq!(
        lower_tool_rejects(&[
            user("before"),
            LlmIr::ToolReject {
                tool_call: call.clone()
            },
        ]),
        vec![
            user("before"),
            LlmIr::ToolSkipOutput {
                tool_call: call,
                reason: "Tool call rejected by user.".into(),
            },
        ]
    );
}

#[test]
fn applies_rejected_tool_lowering_before_generic_checkpoint_lowering() {
    let call = tool_call("call-2", "edit");

    assert_eq!(
        lower_octo_ir(&[
            user("ignored before checkpoint"),
            LlmIr::Checkpoint {
                content: vec![ContentPart::Text {
                    content: "summary".into()
                }]
            },
            LlmIr::ToolReject {
                tool_call: call.clone()
            },
        ]),
        Ok(vec![
            LlmIr::LoweredCheckpoint {
                content: vec![ContentPart::Text {
                    content: "summary".into()
                }]
            },
            LlmIr::ToolSkipOutput {
                tool_call: call,
                reason: "Tool call rejected by user.".into(),
            },
        ])
    );
}
