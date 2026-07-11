use octofriend_models::compiler::{
    CompilerFinishDecision, CompilerFinishDecisionRequest, CompilerFinishOutputRequest,
    CompilerInputUsage, CompilerOutputSource, CompilerUsage, decide_compiler_finish,
    finish_compiler_output,
};
use serde_json::json;

#[test]
fn finish_decision_returns_unexpected_tool_call_before_output_selection() {
    let decision = decide_compiler_finish(&CompilerFinishDecisionRequest {
        tools_enabled: false,
        unexpected_tool_call: true,
        aborted: false,
        curl: "curl provider".into(),
        usage: CompilerUsage {
            input: CompilerInputUsage {
                cached: 1,
                uncached: 2,
                total: 3,
            },
            output: 4,
        },
    });

    assert_eq!(
        decision,
        CompilerFinishDecision::Error {
            error_type: "unexpected-tool-call".into(),
            request_error: "Model returned tool calls even though no tools were provided.".into(),
            curl: "curl provider".into(),
            usage: CompilerUsage {
                input: CompilerInputUsage {
                    cached: 1,
                    uncached: 2,
                    total: 3,
                },
                output: 4,
            },
        }
    );
}

#[test]
fn finish_decision_selects_aborted_or_parsed_output() {
    let usage = CompilerUsage::new(0, 0, 0);

    assert_eq!(
        decide_compiler_finish(&CompilerFinishDecisionRequest {
            tools_enabled: true,
            unexpected_tool_call: false,
            aborted: true,
            curl: "curl provider".into(),
            usage,
        }),
        CompilerFinishDecision::NeedsOutput {
            source: CompilerOutputSource::Aborted,
        }
    );

    assert_eq!(
        decide_compiler_finish(&CompilerFinishDecisionRequest {
            tools_enabled: true,
            unexpected_tool_call: false,
            aborted: false,
            curl: "curl provider".into(),
            usage,
        }),
        CompilerFinishDecision::NeedsOutput {
            source: CompilerOutputSource::Parsed,
        }
    );
}

#[test]
fn finish_output_strips_tool_calls_when_tools_were_not_enabled() {
    let output = finish_compiler_output(&CompilerFinishOutputRequest {
        tools_enabled: false,
        output: json!({
            "role": "assistant",
            "content": "answer",
            "usage": {
                "input": { "cached": 0, "uncached": 0, "total": 0 },
                "output": 0
            },
            "toolCalls": [{ "type": "tool-call", "name": "read" }]
        }),
    });

    assert_eq!(
        output.output,
        json!({
            "role": "assistant",
            "content": "answer",
            "usage": {
                "input": { "cached": 0, "uncached": 0, "total": 0 },
                "output": 0
            }
        })
    );
}
