use std::collections::BTreeMap;
use std::path::PathBuf;

use octofwen_models::compiler::{
    CompilerFinishDecision, CompilerFinishDecisionRequest, CompilerFinishOutputRequest,
    CompilerInputUsage, CompilerOutputSource, CompilerUsage, decide_compiler_finish,
    finish_compiler_output,
};
use octofwen_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};

use super::super::tools::{
    ToolCallParseAvailableToolParam, ToolCallParseBatchParams, ToolCallParseProviderParam,
    ToolCallParseToolParam, tool_call_parse_batch_result_json,
};

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCompilerFinalizeParams {
    provider: ToolCallParseProviderParam,
    tools_enabled: bool,
    unexpected_tool_call: bool,
    aborted: bool,
    curl: String,
    usage: CompilerUsageParam,
    output: Value,
    tools: Vec<ToolCallParseToolParam>,
    available_tools: Vec<ToolCallParseAvailableToolParam>,
    cwd: PathBuf,
    #[serde(default)]
    autofixed_args_by_index: BTreeMap<String, Value>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct CompilerUsageParam {
    input: CompilerInputUsageParam,
    output: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct CompilerInputUsageParam {
    cached: u64,
    uncached: u64,
    total: u64,
}

pub(in crate::runtime) fn provider_compiler_finalize_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ProviderCompilerFinalizeParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    create_json_rpc_success(id, provider_compiler_finalize_result_json(params))
}

fn provider_compiler_finalize_result_json(params: ProviderCompilerFinalizeParams) -> Value {
    let usage = compiler_usage_from_param(params.usage);
    let decision = decide_compiler_finish(&CompilerFinishDecisionRequest {
        tools_enabled: params.tools_enabled,
        unexpected_tool_call: params.unexpected_tool_call,
        aborted: params.aborted,
        curl: params.curl,
        usage,
    });

    let source = match decision {
        CompilerFinishDecision::Error {
            error_type,
            request_error,
            curl,
            usage,
        } => {
            return json!({
                "status": "error",
                "error": {
                    "type": error_type,
                    "requestError": request_error,
                    "curl": curl,
                    "usage": compiler_usage_json(usage),
                }
            });
        }
        CompilerFinishDecision::NeedsOutput { source } => source,
    };

    let selected_output = match source {
        CompilerOutputSource::Aborted => params.output,
        CompilerOutputSource::Parsed => {
            let parse_result = tool_call_parse_batch_result_json(ToolCallParseBatchParams {
                provider: params.provider,
                tools: params.tools,
                available_tools: params.available_tools,
                cwd: params.cwd,
                output: params.output,
                autofixed_args_by_index: params.autofixed_args_by_index,
            });
            if parse_result.get("status").and_then(Value::as_str) == Some("needs-autofix") {
                return parse_result;
            }
            parse_result
                .get("output")
                .cloned()
                .unwrap_or_else(|| json!({}))
        }
    };

    let finished = finish_compiler_output(&CompilerFinishOutputRequest {
        tools_enabled: params.tools_enabled,
        output: selected_output,
    });

    json!({
        "status": "finished",
        "output": finished.output,
    })
}

fn compiler_usage_from_param(usage: CompilerUsageParam) -> CompilerUsage {
    CompilerUsage {
        input: CompilerInputUsage {
            cached: usage.input.cached,
            uncached: usage.input.uncached,
            total: usage.input.total,
        },
        output: usage.output,
    }
}

fn compiler_usage_json(usage: CompilerUsage) -> Value {
    json!({
        "input": {
            "cached": usage.input.cached,
            "uncached": usage.input.uncached,
            "total": usage.input.total,
        },
        "output": usage.output,
    })
}
