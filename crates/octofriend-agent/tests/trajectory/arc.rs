use octofriend_agent::run_events::{
    MalformedToolRequest, TrajectoryAbortState, TrajectoryArcInput, TrajectoryArcRunner,
    TrajectoryEvent, TrajectoryFinish, TrajectoryFinishReason, TrajectoryToolRequest,
};

#[test]
fn aborted_trajectory_exits_before_loading_tools_or_calling_providers() {
    let mut runner = TrajectoryArcRunner::new();
    let finish = runner.run_arc(TrajectoryArcInput {
        abort: TrajectoryAbortState::Aborted,
        messages: Vec::new(),
    });

    assert_eq!(
        finish,
        TrajectoryFinish {
            irs: Vec::new(),
            reason: TrajectoryFinishReason::Abort,
            events: Vec::new(),
        }
    );
    assert_eq!(runner.tools_loaded(), 0);
    assert_eq!(runner.provider_calls(), 0);
    assert!(runner.events().is_empty());
}

#[test]
fn assistant_output_without_tool_calls_finishes_needing_response() {
    let assistant = assistant_message("done");
    let finish = octofriend_agent::run_events::finish_after_assistant_output(
        Vec::new(),
        assistant.clone(),
        None,
        &octofriend_tools::runtime::ToolRegistry::new(),
    );

    assert_eq!(
        finish,
        TrajectoryFinish {
            irs: vec![assistant.into()],
            reason: TrajectoryFinishReason::NeedsResponse,
            events: Vec::new(),
        }
    );
}

#[test]
fn assistant_output_with_valid_tool_calls_finishes_requesting_tools() {
    let assistant = assistant_message("I will read the file");
    let tool_call = tool_call("call-1", "read");
    let registry = validation_registry();
    let finish = octofriend_agent::run_events::finish_after_assistant_output(
        Vec::new(),
        assistant.clone(),
        Some(vec![TrajectoryToolRequest::ToolCall(tool_call.clone())]),
        &registry,
    );

    assert_eq!(
        finish,
        TrajectoryFinish {
            irs: vec![assistant.into()],
            reason: TrajectoryFinishReason::RequestTool {
                tool_calls: vec![tool_call],
            },
            events: Vec::new(),
        }
    );
}

fn assistant_message(content: &str) -> octofriend_models::request_ir::LlmIr {
    octofriend_models::request_ir::LlmIr::Assistant {
        content: content.into(),
        reasoning_content: None,
        usage: octofriend_models::request_ir::TokenUsage {
            cached_input: 0,
            uncached_input: 0,
            total_input: 0,
            output: 0,
        },
    }
}

fn tool_call(id: &str, name: &str) -> octofriend_models::request_ir::ToolCall {
    octofriend_models::request_ir::ToolCall {
        tool_call_id: id.into(),
        name: name.into(),
        original: serde_json::json!({ "name": name, "arguments": { "filePath": "README.md" } }),
        parsed: serde_json::json!({ "filePath": "README.md" }),
    }
}

fn validation_registry() -> octofriend_tools::runtime::ToolRegistry {
    use octofriend_tools::runtime::{TOOL_BUILDER, ToolRegistry};

    let mut registry = ToolRegistry::new();
    registry.insert(
        TOOL_BUILDER
            .declare(
                "read",
                "read a file",
                serde_json::json!({
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

#[test]
fn malformed_tool_output_emits_retry_tool_event_with_retry_trajectory() {
    let assistant = assistant_message("bad tool json");
    let tool_call = tool_call("call-1", "read");
    let malformed = malformed_request("bad-1");
    let finish = octofriend_agent::run_events::finish_after_assistant_output(
        Vec::new(),
        assistant.clone(),
        Some(vec![
            TrajectoryToolRequest::ToolCall(tool_call.clone()),
            TrajectoryToolRequest::Malformed(malformed.clone()),
        ]),
        &validation_registry(),
    );
    let expected_irs = vec![
        assistant.into(),
        octofriend_models::request_ir::LlmIr::ToolSkipOutput {
            tool_call,
            reason: octofriend_agent::run_events::MALFORMED_BATCH_SKIP_REASON.into(),
        }
        .into(),
        octofriend_agent::run_events::TrajectoryOutputIr::ToolParseError {
            malformed_request: malformed,
        },
    ];

    assert_eq!(
        finish,
        TrajectoryFinish {
            irs: expected_irs.clone(),
            reason: TrajectoryFinishReason::NeedsResponse,
            events: vec![TrajectoryEvent::RetryTool { irs: expected_irs }],
        }
    );
}

#[test]
fn invalid_tool_output_emits_retry_tool_event_with_validation_errors() {
    let assistant = assistant_message("invalid read args");
    let invalid_tool_call = octofriend_models::request_ir::ToolCall {
        parsed: serde_json::json!({}),
        ..tool_call("call-1", "read")
    };
    let finish = octofriend_agent::run_events::finish_after_assistant_output(
        Vec::new(),
        assistant.clone(),
        Some(vec![TrajectoryToolRequest::ToolCall(
            invalid_tool_call.clone(),
        )]),
        &validation_registry(),
    );
    let expected_irs = vec![
        assistant.into(),
        octofriend_agent::run_events::TrajectoryOutputIr::ToolValidationError {
            tool_call: invalid_tool_call,
            error: "missing required tool argument filePath".into(),
            aborted: false,
        },
    ];

    assert_eq!(
        finish,
        TrajectoryFinish {
            irs: expected_irs.clone(),
            reason: TrajectoryFinishReason::NeedsResponse,
            events: vec![TrajectoryEvent::RetryTool { irs: expected_irs }],
        }
    );
}

fn malformed_request(id: &str) -> MalformedToolRequest {
    MalformedToolRequest {
        error: "invalid JSON".into(),
        tool_call_id: id.into(),
        original_name: "edit".into(),
        original_arguments: serde_json::json!("not-json"),
    }
}

#[test]
fn trajectory_events_include_compaction_start_and_autofix_markers() {
    assert_eq!(
        octofriend_agent::run_events::start_compaction_event(),
        TrajectoryEvent::StartCompaction
    );
    assert_eq!(
        octofriend_agent::run_events::autofixing_json_event(),
        TrajectoryEvent::AutofixingJson
    );
    assert_eq!(
        octofriend_agent::run_events::autofixing_diff_event(),
        TrajectoryEvent::AutofixingDiff
    );
}
