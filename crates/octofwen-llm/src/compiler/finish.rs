use crate::compiler::usage::CompilerUsage;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CompilerError {
    Request {
        request_error: String,
        curl: String,
    },
    Stream {
        request_error: String,
        curl: String,
        usage: CompilerUsage,
    },
    Payment {
        request_error: String,
        curl: String,
    },
    RateLimit {
        request_error: String,
        curl: String,
    },
    UnexpectedToolCall {
        request_error: String,
        curl: String,
        usage: CompilerUsage,
    },
}

pub fn unexpected_tool_call_error(curl: impl Into<String>, usage: CompilerUsage) -> CompilerError {
    CompilerError::UnexpectedToolCall {
        request_error: "Model returned tool calls even though no tools were provided.".into(),
        curl: curl.into(),
        usage,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CompilerOutputSource {
    Aborted,
    Parsed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompilerFinishDecisionRequest {
    pub tools_enabled: bool,
    pub unexpected_tool_call: bool,
    pub aborted: bool,
    pub curl: String,
    pub usage: CompilerUsage,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CompilerFinishDecision {
    Error {
        error_type: String,
        request_error: String,
        curl: String,
        usage: CompilerUsage,
    },
    NeedsOutput {
        source: CompilerOutputSource,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct CompilerFinishOutputRequest {
    pub tools_enabled: bool,
    pub output: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CompilerFinishOutputResult {
    pub output: serde_json::Value,
}

pub fn decide_compiler_finish(request: &CompilerFinishDecisionRequest) -> CompilerFinishDecision {
    if request.unexpected_tool_call && !request.tools_enabled {
        return CompilerFinishDecision::Error {
            error_type: "unexpected-tool-call".into(),
            request_error: "Model returned tool calls even though no tools were provided.".into(),
            curl: request.curl.clone(),
            usage: request.usage,
        };
    }

    CompilerFinishDecision::NeedsOutput {
        source: if request.aborted {
            CompilerOutputSource::Aborted
        } else {
            CompilerOutputSource::Parsed
        },
    }
}

pub fn finish_compiler_output(request: &CompilerFinishOutputRequest) -> CompilerFinishOutputResult {
    let mut output = request.output.clone();
    if !request.tools_enabled {
        if let Some(object) = output.as_object_mut() {
            object.remove("toolCalls");
        }
    }
    CompilerFinishOutputResult { output }
}
