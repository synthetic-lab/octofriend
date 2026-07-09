use super::TrajectoryEvent;
use octofwen_models::compiler::CompilerError;
use octofwen_models::providers::synthetic::{QuotaData, parse_quota_json};
use octofwen_models::request_ir::ToolCall;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TrajectoryFinishReason {
    Abort,
    NeedsResponse,
    RequestTool {
        tool_calls: Vec<ToolCall>,
    },
    RequestError {
        request_error: String,
        curl: String,
    },
    PaymentError {
        request_error: String,
        curl: String,
    },
    RateLimitError {
        request_error: String,
        curl: String,
    },
    CompactionError {
        request_error: String,
        curl: Option<String>,
    },
}

pub fn compiler_error_to_finish_reason(error: CompilerError) -> TrajectoryFinishReason {
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
        } => TrajectoryFinishReason::RequestError {
            request_error,
            curl,
        },
    }
}

pub fn quota_update_event_from_headers(headers: &[(String, String)]) -> Option<TrajectoryEvent> {
    parse_quota_from_headers(headers).map(|quota| TrajectoryEvent::QuotaUpdated { quota })
}

pub fn parse_quota_from_headers(headers: &[(String, String)]) -> Option<QuotaData> {
    let raw = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("x-synthetic-quotas"))
        .map(|(_, value)| value.as_str())?;
    parse_quota_json(raw)
}
