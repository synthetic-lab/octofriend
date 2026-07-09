use std::path::PathBuf;

use octofwen_llm::compiler::{
    ToolCallOutputItem, ToolCallOutputRequest, ToolCallPreparseInput, ToolCallPreparseResult,
    ToolParseExecutionInput, ToolParseExecutionRequest, ToolParseInputProvider,
    ToolParseInputRequest, build_tool_call_output, build_tool_parse_execution_result,
    build_tool_parse_inputs, normalize_openai_strict_function_arguments, preparse_tool_call,
};
use octofwen_llm::providers::stream::ProviderStreamTool;
use octofwen_tools::runtime::{ToolBuilder, parse_tool_arguments, validate_json_schema_arguments};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::agentd) struct ToolCallParseOneParams {
    provider: ToolCallParseProviderParam,
    tool: ToolCallParseToolParam,
    available_tools: Vec<ToolCallParseAvailableToolParam>,
    cwd: PathBuf,
    autofixed_args: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::agentd) struct ToolCallParseToolParam {
    pub(in crate::agentd) index: u64,
    pub(in crate::agentd) id: Option<String>,
    pub(in crate::agentd) name: Option<String>,
    pub(in crate::agentd) arguments: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(in crate::agentd) enum ToolCallParseProviderParam {
    OpenaiChatCompletions,
    OpenaiResponses,
    Anthropic,
    Gemini,
}

#[derive(Clone, Debug, Deserialize)]
pub(in crate::agentd) struct ToolCallParseAvailableToolParam {
    pub(in crate::agentd) name: String,
    pub(in crate::agentd) schema: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::agentd) struct ToolCallParseBatchParams {
    pub(in crate::agentd) provider: ToolCallParseProviderParam,
    pub(in crate::agentd) tools: Vec<ToolCallParseToolParam>,
    pub(in crate::agentd) available_tools: Vec<ToolCallParseAvailableToolParam>,
    pub(in crate::agentd) cwd: PathBuf,
    pub(in crate::agentd) output: Value,
    #[serde(default)]
    pub(in crate::agentd) autofixed_args_by_index: BTreeMap<String, Value>,
}

pub(in crate::agentd) fn tool_call_parse_batch_result_json(
    params: ToolCallParseBatchParams,
) -> Value {
    let mut tool_calls = Vec::new();
    let mut autofix_requests = Vec::new();

    for tool in params.tools {
        let tool_index = tool.index;
        let parse_result = tool_call_parse_result_json(ToolCallParseOneParams {
            provider: params.provider,
            tool,
            available_tools: params.available_tools.clone(),
            cwd: params.cwd.clone(),
            autofixed_args: params
                .autofixed_args_by_index
                .get(&tool_index.to_string())
                .cloned(),
        });

        match parse_result.get("status").and_then(Value::as_str) {
            Some("needs-autofix") => autofix_requests.push(json!({
                "index": tool_index,
                "badJson": parse_result.get("badJson").cloned().unwrap_or(Value::String(String::new())),
                "message": parse_result.get("message").cloned().unwrap_or(Value::String(String::new())),
            })),
            Some("success") | Some("error") => {
                if let Some(tool) = parse_result.get("tool") {
                    tool_calls.push(tool.clone());
                }
            }
            _ => {}
        }
    }

    if !autofix_requests.is_empty() {
        return json!({
            "status": "needs-autofix",
            "requests": autofix_requests,
        });
    }

    let mut output = params.output;
    if !tool_calls.is_empty() {
        if let Value::Object(object) = &mut output {
            object.insert("toolCalls".into(), Value::Array(tool_calls));
        } else {
            let mut object = Map::new();
            object.insert("toolCalls".into(), Value::Array(tool_calls));
            output = Value::Object(object);
        }
    }

    json!({
        "status": "success",
        "output": output,
    })
}

fn tool_call_parse_result_json(params: ToolCallParseOneParams) -> Value {
    let Ok(tool_input) = tool_parse_input(params.provider, params.tool) else {
        return tool_call_parse_error_json(
            String::new(),
            String::new(),
            Value::Null,
            "No tool parse input produced".to_owned(),
        );
    };
    let fallback_tool_call_id = tool_input.tool_call_id.clone();
    let fallback_tool_name = tool_input.tool_name.clone();
    let fallback_args = tool_input.args.clone();
    let available_tool_names = params
        .available_tools
        .iter()
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();
    let preparse_result = preparse_tool_call(&ToolCallPreparseInput {
        tool_call_id: tool_input.tool_call_id,
        tool_name: tool_input.tool_name,
        args: tool_input.args,
        available_tool_names,
        autofixed_args: params.autofixed_args,
    });

    let (tool_call_id, tool_name, args) = match preparse_result {
        ToolCallPreparseResult::Ready {
            tool_call_id,
            tool_name,
            args,
        } => (tool_call_id, tool_name, args),
        ToolCallPreparseResult::NeedsAutofix { bad_json, message } => {
            return json!({
                "status": "needs-autofix",
                "badJson": bad_json,
                "message": message,
            });
        }
        ToolCallPreparseResult::Error { message } => {
            return tool_call_parse_error_json(
                fallback_tool_call_id,
                fallback_tool_name,
                fallback_args,
                message,
            );
        }
    };

    let Some(tool) = params
        .available_tools
        .into_iter()
        .find(|tool| tool.name == tool_name)
    else {
        return tool_call_parse_error_json(
            tool_call_id,
            tool_name.clone(),
            args,
            format!("Unknown tool {tool_name}"),
        );
    };

    let builder_tool = ToolBuilder
        .declare(tool_name.clone(), "", tool.schema.clone())
        .define();
    let args = normalize_tool_parse_args(params.provider, &tool.schema, args);

    if let Err(error) =
        validate_json_schema_arguments(&builder_tool.definition.arguments_schema, &args)
    {
        let request = ToolParseExecutionRequest {
            tool_call_id,
            tool_name,
            args: args.clone(),
            input: ToolParseExecutionInput::SchemaError {
                error,
                expected: serde_json::to_string(&builder_tool.definition.arguments_schema)
                    .unwrap_or_else(|_| serde_json::json!({}).to_string()),
            },
        };
        return tool_parse_execution_result_json(&request);
    }

    match parse_tool_arguments(&tool_name, params.cwd, args.clone()) {
        Ok(parsed) => {
            let request = ToolParseExecutionRequest {
                tool_call_id,
                tool_name,
                args,
                input: ToolParseExecutionInput::Parsed {
                    original: parsed.original,
                    parsed: parsed.parsed,
                },
            };
            tool_parse_execution_result_json(&request)
        }
        Err(message) => {
            let request = ToolParseExecutionRequest {
                tool_call_id,
                tool_name,
                args,
                input: ToolParseExecutionInput::ToolError { message },
            };
            tool_parse_execution_result_json(&request)
        }
    }
}

fn normalize_tool_parse_args(
    provider: ToolCallParseProviderParam,
    schema: &Value,
    args: Value,
) -> Value {
    match provider {
        ToolCallParseProviderParam::OpenaiResponses => {
            normalize_openai_strict_function_arguments(schema, &args)
        }
        ToolCallParseProviderParam::OpenaiChatCompletions
        | ToolCallParseProviderParam::Anthropic
        | ToolCallParseProviderParam::Gemini => args,
    }
}

fn tool_parse_input(
    provider: ToolCallParseProviderParam,
    tool: ToolCallParseToolParam,
) -> Result<octofwen_llm::compiler::ToolParseInputItem, String> {
    let result = build_tool_parse_inputs(&ToolParseInputRequest {
        provider: tool_parse_input_provider(provider),
        tools: vec![ProviderStreamTool {
            index: tool.index,
            id: tool.id,
            name: tool.name,
            arguments: tool.arguments,
        }],
    });
    result
        .items
        .into_iter()
        .next()
        .ok_or_else(|| "No tool parse input produced".to_owned())
}

fn tool_parse_input_provider(provider: ToolCallParseProviderParam) -> ToolParseInputProvider {
    match provider {
        ToolCallParseProviderParam::OpenaiChatCompletions => {
            ToolParseInputProvider::OpenAiChatCompletions
        }
        ToolCallParseProviderParam::OpenaiResponses => ToolParseInputProvider::OpenAiResponses,
        ToolCallParseProviderParam::Anthropic => ToolParseInputProvider::Anthropic,
        ToolCallParseProviderParam::Gemini => ToolParseInputProvider::Gemini,
    }
}

fn tool_parse_execution_result_json(request: &ToolParseExecutionRequest) -> Value {
    let result = build_tool_parse_execution_result(request);
    match result {
        octofwen_llm::compiler::ToolParseExecutionResult::Success { tool } => json!({
            "status": "success",
            "tool": tool,
        }),
        octofwen_llm::compiler::ToolParseExecutionResult::Error { message } => {
            tool_call_parse_error_json(
                request.tool_call_id.clone(),
                request.tool_name.clone(),
                request.args.clone(),
                message,
            )
        }
    }
}

fn tool_call_parse_error_json(
    tool_call_id: String,
    tool_name: String,
    args: Value,
    message: String,
) -> Value {
    json!({
        "status": "error",
        "message": message,
        "tool": malformed_tool_call_json(tool_call_id, tool_name, args, message),
    })
}

fn malformed_tool_call_json(
    tool_call_id: String,
    tool_name: String,
    args: Value,
    message: String,
) -> Value {
    let result = build_tool_call_output(&ToolCallOutputRequest {
        items: vec![ToolCallOutputItem::Malformed {
            tool_call_id,
            name: tool_name,
            arguments: args,
            error: message,
        }],
    });
    result.tool_calls.into_iter().next().unwrap_or(Value::Null)
}
