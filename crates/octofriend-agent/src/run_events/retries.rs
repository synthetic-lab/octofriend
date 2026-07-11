use octofriend_models::request_ir::{LlmIr, ToolCall};
use octofriend_tools::runtime::{ToolCall as RuntimeToolCall, ToolRegistry};
use serde_json::Value;

pub const SKIP_INVALID_REASON: &str =
    "One of your other tool calls was invalid, so no tool calls were run";
pub const MALFORMED_BATCH_SKIP_REASON: &str =
    "Another tool call in this batch was malformed, so this tool call was skipped";
pub const MALFORMED_TOOL_ORDERING_ERROR: &str =
    "Impossible tool ordering: encountered a malformed tool with no malformed response";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MalformedToolRequest {
    pub error: String,
    pub tool_call_id: String,
    pub original_name: String,
    pub original_arguments: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrajectoryToolRequest {
    ToolCall(ToolCall),
    Malformed(MalformedToolRequest),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrajectoryOutputIr {
    Llm(LlmIr),
    ToolParseError {
        malformed_request: MalformedToolRequest,
    },
    ToolValidationError {
        tool_call: ToolCall,
        error: String,
        aborted: bool,
    },
}

impl From<LlmIr> for TrajectoryOutputIr {
    fn from(value: LlmIr) -> Self {
        Self::Llm(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrajectoryRetryError {
    MalformedToolRequestInWellformedBatch,
}

impl TrajectoryRetryError {
    pub const fn message(&self) -> &'static str {
        match self {
            Self::MalformedToolRequestInWellformedBatch => MALFORMED_TOOL_ORDERING_ERROR,
        }
    }
}

pub fn has_malformed_tool_requests(tool_requests: &[TrajectoryToolRequest]) -> bool {
    tool_requests
        .iter()
        .any(|request| matches!(request, TrajectoryToolRequest::Malformed(_)))
}

pub fn append_malformed_tool_retry_irs(
    mut irs: Vec<TrajectoryOutputIr>,
    tool_requests: &[TrajectoryToolRequest],
) -> Vec<TrajectoryOutputIr> {
    for request in tool_requests {
        match request {
            TrajectoryToolRequest::ToolCall(tool_call) => {
                irs.push(
                    LlmIr::ToolSkipOutput {
                        tool_call: tool_call.clone(),
                        reason: MALFORMED_BATCH_SKIP_REASON.into(),
                    }
                    .into(),
                );
            }
            TrajectoryToolRequest::Malformed(malformed_request) => {
                irs.push(TrajectoryOutputIr::ToolParseError {
                    malformed_request: malformed_request.clone(),
                });
            }
        }
    }

    irs
}

pub fn require_wellformed_tool_calls(
    tool_requests: &[TrajectoryToolRequest],
) -> Result<Vec<ToolCall>, TrajectoryRetryError> {
    let mut tool_calls = Vec::new();
    for request in tool_requests {
        match request {
            TrajectoryToolRequest::ToolCall(tool_call) => tool_calls.push(tool_call.clone()),
            TrajectoryToolRequest::Malformed(_) => {
                return Err(TrajectoryRetryError::MalformedToolRequestInWellformedBatch);
            }
        }
    }

    Ok(tool_calls)
}

pub fn has_retryable_tool_validation_failure(retry_irs: &[TrajectoryOutputIr]) -> bool {
    retry_irs
        .iter()
        .any(|ir| !matches!(ir, TrajectoryOutputIr::Llm(LlmIr::ToolSkipOutput { .. })))
}

pub fn validate_tool_calls_for_retry(
    tool_calls: &[ToolCall],
    registry: &ToolRegistry,
) -> Vec<TrajectoryOutputIr> {
    let mut retry_irs = Vec::new();

    for tool_call in tool_calls {
        let runtime_call = RuntimeToolCall {
            tool_call_id: tool_call.tool_call_id.clone(),
            name: tool_call.name.clone(),
            original: tool_call.original.clone(),
            parsed: tool_call.parsed.clone(),
        };

        match registry.validate_call(&runtime_call) {
            Ok(()) => retry_irs.push(
                LlmIr::ToolSkipOutput {
                    tool_call: tool_call.clone(),
                    reason: SKIP_INVALID_REASON.into(),
                }
                .into(),
            ),
            Err(error) => retry_irs.push(TrajectoryOutputIr::ToolValidationError {
                tool_call: tool_call.clone(),
                error,
                aborted: false,
            }),
        }
    }

    retry_irs
}
