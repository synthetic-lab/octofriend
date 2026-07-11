use super::{
    CompactionTokenDelta, ResponseTokenDelta, TrajectoryFinishReason, TrajectoryOutputIr,
    TrajectoryToolRequest, append_malformed_tool_retry_irs, has_malformed_tool_requests,
    has_retryable_tool_validation_failure, require_wellformed_tool_calls,
    validate_tool_calls_for_retry,
};
use octofriend_models::providers::synthetic::QuotaData;
use octofriend_models::request_ir::LlmIr;
use octofriend_tools::runtime::ToolRegistry;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrajectoryAbortState {
    Running,
    Aborted,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrajectoryArcInput {
    pub abort: TrajectoryAbortState,
    pub messages: Vec<LlmIr>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrajectoryFinish {
    pub irs: Vec<TrajectoryOutputIr>,
    pub reason: TrajectoryFinishReason,
    pub events: Vec<TrajectoryEvent>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum TrajectoryEvent {
    StartCompaction,
    StartResponse,
    AutofixingJson,
    AutofixingDiff,
    ResponseProgress {
        buffer: octofriend_models::compiler::CompilerTokenBuffer,
        delta: ResponseTokenDelta,
    },
    CompactionProgress {
        buffer: octofriend_models::compiler::CompilerTokenBuffer,
        delta: CompactionTokenDelta,
    },
    CompactionParsed {
        checkpoint: LlmIr,
    },
    QuotaUpdated {
        quota: QuotaData,
    },
    RetryTool {
        irs: Vec<TrajectoryOutputIr>,
    },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TrajectoryArcRunner {
    tools_loaded: usize,
    provider_calls: usize,
    events: Vec<TrajectoryEvent>,
}

impl TrajectoryArcRunner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn run_arc(&mut self, input: TrajectoryArcInput) -> TrajectoryFinish {
        if input.abort == TrajectoryAbortState::Aborted {
            return abort(Vec::new());
        }

        self.load_tools();
        self.events.push(TrajectoryEvent::StartResponse);
        self.call_provider();

        TrajectoryFinish {
            irs: input.messages.into_iter().map(Into::into).collect(),
            reason: TrajectoryFinishReason::NeedsResponse,
            events: Vec::new(),
        }
    }

    pub fn tools_loaded(&self) -> usize {
        self.tools_loaded
    }

    pub fn provider_calls(&self) -> usize {
        self.provider_calls
    }

    pub fn events(&self) -> &[TrajectoryEvent] {
        &self.events
    }

    fn load_tools(&mut self) {
        self.tools_loaded += 1;
    }

    fn call_provider(&mut self) {
        self.provider_calls += 1;
    }
}

pub fn abort(irs: Vec<TrajectoryOutputIr>) -> TrajectoryFinish {
    TrajectoryFinish {
        irs,
        reason: TrajectoryFinishReason::Abort,
        events: Vec::new(),
    }
}

pub fn start_compaction_event() -> TrajectoryEvent {
    TrajectoryEvent::StartCompaction
}

pub fn autofixing_json_event() -> TrajectoryEvent {
    TrajectoryEvent::AutofixingJson
}

pub fn autofixing_diff_event() -> TrajectoryEvent {
    TrajectoryEvent::AutofixingDiff
}

pub fn finish_after_assistant_output(
    mut irs: Vec<TrajectoryOutputIr>,
    assistant_message: LlmIr,
    tool_requests: Option<Vec<TrajectoryToolRequest>>,
    registry: &ToolRegistry,
) -> TrajectoryFinish {
    irs.push(assistant_message.into());

    let Some(tool_requests) = tool_requests else {
        return TrajectoryFinish {
            irs,
            reason: TrajectoryFinishReason::NeedsResponse,
            events: Vec::new(),
        };
    };

    if has_malformed_tool_requests(&tool_requests) {
        let retry_irs = append_malformed_tool_retry_irs(irs, &tool_requests);
        return TrajectoryFinish {
            irs: retry_irs.clone(),
            reason: TrajectoryFinishReason::NeedsResponse,
            events: vec![TrajectoryEvent::RetryTool { irs: retry_irs }],
        };
    }

    let Ok(tool_calls) = require_wellformed_tool_calls(&tool_requests) else {
        return TrajectoryFinish {
            irs,
            reason: TrajectoryFinishReason::NeedsResponse,
            events: Vec::new(),
        };
    };

    let retry_irs = validate_tool_calls_for_retry(&tool_calls, registry);
    if has_retryable_tool_validation_failure(&retry_irs) {
        irs.extend(retry_irs);
        return TrajectoryFinish {
            irs: irs.clone(),
            reason: TrajectoryFinishReason::NeedsResponse,
            events: vec![TrajectoryEvent::RetryTool { irs }],
        };
    }

    TrajectoryFinish {
        irs,
        reason: TrajectoryFinishReason::RequestTool { tool_calls },
        events: Vec::new(),
    }
}
