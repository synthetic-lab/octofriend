use octofwen_agent::run_events::{
    MALFORMED_BATCH_SKIP_REASON, MalformedToolRequest, TrajectoryRetryError, TrajectoryToolRequest,
    append_malformed_tool_retry_irs, has_malformed_tool_requests,
    has_retryable_tool_validation_failure, require_wellformed_tool_calls,
};
use octofwen_models::request_ir::{LlmIr, ToolCall};
use serde_json::json;

#[test]
fn detects_malformed_tool_requests_in_assistant_batches() {
    assert!(!has_malformed_tool_requests(&[
        TrajectoryToolRequest::ToolCall(tool_call("call-1", "read"),)
    ]));
    assert!(has_malformed_tool_requests(&[
        TrajectoryToolRequest::ToolCall(tool_call("call-1", "read")),
        TrajectoryToolRequest::Malformed(malformed_request("bad-1")),
    ]));
}

#[test]
fn malformed_tool_batches_emit_parse_errors_and_skip_wellformed_calls() {
    let existing = vec![LlmIr::Trajectory.into()];
    let retry_irs = append_malformed_tool_retry_irs(
        existing,
        &[
            TrajectoryToolRequest::ToolCall(tool_call("call-1", "read")),
            TrajectoryToolRequest::Malformed(malformed_request("bad-1")),
        ],
    );

    assert_eq!(
        retry_irs,
        vec![
            LlmIr::Trajectory.into(),
            LlmIr::ToolSkipOutput {
                tool_call: tool_call("call-1", "read"),
                reason: MALFORMED_BATCH_SKIP_REASON.into(),
            }
            .into(),
            octofwen_agent::run_events::TrajectoryOutputIr::ToolParseError {
                malformed_request: malformed_request("bad-1"),
            },
        ]
    );
}

#[test]
fn requiring_wellformed_tool_calls_rejects_malformed_requests() {
    assert_eq!(
        require_wellformed_tool_calls(&[
            TrajectoryToolRequest::ToolCall(tool_call("call-1", "read")),
            TrajectoryToolRequest::Malformed(malformed_request("bad-1")),
        ]),
        Err(TrajectoryRetryError::MalformedToolRequestInWellformedBatch)
    );
}

#[test]
fn retryable_tool_validation_failure_ignores_only_skip_outputs() {
    assert!(!has_retryable_tool_validation_failure(&[
        LlmIr::ToolSkipOutput {
            tool_call: tool_call("call-1", "read"),
            reason: "skip".into(),
        }
        .into(),
    ]));
    assert!(has_retryable_tool_validation_failure(&[
        LlmIr::ToolSkipOutput {
            tool_call: tool_call("call-1", "read"),
            reason: "skip".into(),
        }
        .into(),
        octofwen_agent::run_events::TrajectoryOutputIr::ToolValidationError {
            tool_call: tool_call("call-2", "edit"),
            error: "invalid edit".into(),
            aborted: false,
        },
    ]));
}

fn tool_call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        tool_call_id: id.into(),
        name: name.into(),
        original: json!({ "name": name, "arguments": { "filePath": "README.md" } }),
        parsed: json!({ "filePath": "README.md" }),
    }
}

fn malformed_request(id: &str) -> MalformedToolRequest {
    MalformedToolRequest {
        error: "invalid JSON".into(),
        tool_call_id: id.into(),
        original_name: "edit".into(),
        original_arguments: json!("not-json"),
    }
}

#[test]
fn validation_retry_converts_valid_tool_calls_to_skip_outputs() {
    let registry = validation_registry();
    let retry_irs = octofwen_agent::run_events::validate_tool_calls_for_retry(
        &[tool_call("call-1", "read")],
        &registry,
    );

    assert_eq!(
        retry_irs,
        vec![
            LlmIr::ToolSkipOutput {
                tool_call: tool_call("call-1", "read"),
                reason: octofwen_agent::run_events::SKIP_INVALID_REASON.into(),
            }
            .into()
        ]
    );
}

#[test]
fn validation_retry_returns_validation_errors_for_invalid_tool_calls() {
    let registry = validation_registry();
    let retry_irs = octofwen_agent::run_events::validate_tool_calls_for_retry(
        &[ToolCall {
            parsed: json!({}),
            ..tool_call("call-1", "read")
        }],
        &registry,
    );

    assert_eq!(
        retry_irs,
        vec![
            octofwen_agent::run_events::TrajectoryOutputIr::ToolValidationError {
                tool_call: ToolCall {
                    parsed: json!({}),
                    ..tool_call("call-1", "read")
                },
                error: "missing required tool argument filePath".into(),
                aborted: false,
            }
        ]
    );
}

#[test]
fn validation_retry_reports_missing_tools_as_validation_errors() {
    let retry_irs = octofwen_agent::run_events::validate_tool_calls_for_retry(
        &[tool_call("call-1", "read")],
        &octofwen_tools::runtime::ToolRegistry::new(),
    );

    assert_eq!(
        retry_irs,
        vec![
            octofwen_agent::run_events::TrajectoryOutputIr::ToolValidationError {
                tool_call: tool_call("call-1", "read"),
                error: "unknown tool read".into(),
                aborted: false,
            }
        ]
    );
}

fn validation_registry() -> octofwen_tools::runtime::ToolRegistry {
    use octofwen_tools::runtime::{TOOL_BUILDER, ToolRegistry};

    let mut registry = ToolRegistry::new();
    registry.insert(
        TOOL_BUILDER
            .declare(
                "read",
                "read a file",
                json!({
                    "type": "object",
                    "required": ["filePath"],
                    "properties": {
                        "filePath": { "type": "string" }
                    }
                }),
            )
            .define(),
    );
    registry
}
