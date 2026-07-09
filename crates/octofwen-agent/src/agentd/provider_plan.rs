use super::provider::ProviderHttpStreamRequest;
use super::reasoning::{
    anthropic_output_config, anthropic_thinking, gemini_generation_config,
    openai_responses_reasoning,
};
use octofwen_llm::compiler::AssistantOutputProvider;
use octofwen_llm::providers::anthropic::{
    AnthropicCurlRequest, AnthropicMessagesHttpRequestParams, anthropic_messages_curl,
    anthropic_messages_http_request,
};
use octofwen_llm::providers::gemini::{
    GeminiGenerateContentCurlRequest, GeminiGenerateContentHttpRequestParams,
    gemini_generate_content_curl, gemini_generate_content_http_request,
};
use octofwen_llm::providers::openai::{
    OpenAiChatCompletionsCurlRequest, OpenAiChatCompletionsHttpRequestParams,
    OpenAiResponsesCurlRequest, OpenAiResponsesHttpRequestParams, openai_chat_completions_curl,
    openai_chat_completions_http_request, openai_responses_curl, openai_responses_http_request,
};
use octofwen_llm::providers::tool_definitions::{
    ProviderToolDefinition, ProviderToolDefinitionTarget, provider_tool_definitions_json,
};
use octofwen_llm::providers::{
    ProviderHttpRequest, anthropic_messages_from_ts_ir, gemini_contents_from_ts_ir,
    openai_chat_completions_messages_from_ts_ir, openai_responses_input_from_ts_ir,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::agentd) struct ProviderCompilerPlanParams {
    #[serde(rename = "type")]
    pub(in crate::agentd) provider_type: Option<ProviderCompilerPlanTypeParam>,
    #[serde(rename = "baseUrl")]
    pub(in crate::agentd) base_url: String,
    pub(in crate::agentd) model: String,
    pub(in crate::agentd) context: u64,
    pub(in crate::agentd) reasoning: Option<ProviderReasoningParam>,
    #[serde(rename = "thinkingBudgetTokens")]
    pub(in crate::agentd) thinking_budget_tokens: Option<u64>,
    pub(in crate::agentd) modalities: Option<ProviderCompilerModalitiesParam>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(in crate::agentd) enum ProviderCompilerPlanTypeParam {
    Standard,
    OpenaiResponses,
    Anthropic,
    Gemini,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum ProviderReasoningParam {
    None,
    Minimal,
    Low,
    Medium,
    High,
    #[serde(rename = "xhigh")]
    XHigh,
}

#[derive(Debug, Deserialize)]
pub(in crate::agentd) struct ProviderCompilerModalitiesParam {
    image: Option<ProviderCompilerImageModalityParam>,
}

#[derive(Debug, Deserialize)]
pub(in crate::agentd) struct ProviderCompilerImageModalityParam {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::agentd) struct ProviderHttpRequestParams {
    pub(in crate::agentd) plan: ProviderHttpRequestPlanParam,
    #[serde(rename = "apiKey")]
    pub(in crate::agentd) api_key: String,
    pub(in crate::agentd) irs: Vec<Value>,
    pub(in crate::agentd) system: Option<String>,
    pub(in crate::agentd) tools: Option<Vec<ProviderToolDefinition>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::agentd) struct ProviderCompilerRequestParams {
    #[serde(rename = "type")]
    pub(in crate::agentd) provider_type: Option<ProviderCompilerPlanTypeParam>,
    #[serde(rename = "baseUrl")]
    pub(in crate::agentd) base_url: String,
    pub(in crate::agentd) model: String,
    pub(in crate::agentd) context: u64,
    pub(in crate::agentd) reasoning: Option<ProviderReasoningParam>,
    #[serde(rename = "thinkingBudgetTokens")]
    pub(in crate::agentd) thinking_budget_tokens: Option<u64>,
    pub(in crate::agentd) modalities: Option<ProviderCompilerModalitiesParam>,
    #[serde(rename = "apiKey")]
    pub(in crate::agentd) api_key: String,
    pub(in crate::agentd) irs: Vec<Value>,
    pub(in crate::agentd) system: Option<String>,
    pub(in crate::agentd) tools: Option<Vec<ProviderToolDefinition>>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "provider", rename_all = "kebab-case")]
pub(in crate::agentd) enum ProviderHttpRequestPlanParam {
    OpenaiChatCompletions {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
    },
    OpenaiResponses {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
        reasoning: Option<Value>,
    },
    Anthropic {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
        #[serde(rename = "maxTokens")]
        max_tokens: u64,
        thinking: Option<Value>,
        #[serde(rename = "outputConfig")]
        output_config: Option<Value>,
    },
    Gemini {
        #[serde(rename = "baseUrl")]
        base_url: String,
        model: String,
        modalities: Option<Vec<String>>,
        #[serde(rename = "generationConfig")]
        generation_config: Option<Value>,
    },
}

pub(in crate::agentd) fn provider_compiler_plan_json(
    params: ProviderCompilerPlanParams,
) -> serde_json::Map<String, Value> {
    let mut modalities = vec![Value::String("text".into())];
    if params
        .modalities
        .as_ref()
        .and_then(|modalities| modalities.image.as_ref())
        .is_some_and(|image| image.enabled)
    {
        modalities.push(Value::String("vision".into()));
    }

    let provider_type = params
        .provider_type
        .unwrap_or(ProviderCompilerPlanTypeParam::Standard);
    let mut result = serde_json::Map::from_iter([
        ("baseUrl".into(), Value::String(params.base_url)),
        ("model".into(), Value::String(params.model.clone())),
        ("modalities".into(), Value::Array(modalities)),
    ]);

    match provider_type {
        ProviderCompilerPlanTypeParam::Standard => {
            result.insert(
                "provider".into(),
                Value::String("openai-chat-completions".into()),
            );
        }
        ProviderCompilerPlanTypeParam::OpenaiResponses => {
            result.insert("provider".into(), Value::String("openai-responses".into()));
            if let Some(reasoning) = openai_responses_reasoning(params.reasoning) {
                result.insert("reasoning".into(), reasoning);
            }
        }
        ProviderCompilerPlanTypeParam::Anthropic => {
            result.insert("provider".into(), Value::String("anthropic".into()));
            let max_tokens = params.context.min(32_000);
            result.insert("maxTokens".into(), Value::from(max_tokens));
            let thinking = anthropic_thinking(
                &params.model,
                params.reasoning,
                params.thinking_budget_tokens,
                max_tokens,
            );
            if let Some(thinking) = thinking {
                result.insert("thinking".into(), thinking);
            }
            if let Some(output_config) = anthropic_output_config(&params.model, params.reasoning) {
                result.insert("outputConfig".into(), output_config);
            }
        }
        ProviderCompilerPlanTypeParam::Gemini => {
            result.insert("provider".into(), Value::String("gemini".into()));
            if let Some(generation_config) = gemini_generation_config(
                &params.model,
                params.reasoning,
                params.thinking_budget_tokens,
            ) {
                result.insert("generationConfig".into(), generation_config);
            }
        }
    }

    result
}

#[expect(
    clippy::too_many_lines,
    reason = "provider request builder mirrors provider-specific wire sections"
)]
pub(in crate::agentd) fn provider_http_request_parts(
    params: ProviderHttpRequestParams,
) -> Result<
    (
        &'static str,
        AssistantOutputProvider,
        ProviderHttpRequest,
        String,
    ),
    (),
> {
    let ProviderHttpRequestParams {
        plan,
        api_key,
        irs,
        system,
        tools,
    } = params;

    let result = match plan {
        ProviderHttpRequestPlanParam::OpenaiChatCompletions {
            base_url,
            model,
            modalities,
        } => {
            let Ok(messages) = openai_chat_completions_messages_from_ts_ir(
                &irs,
                system.as_deref(),
                modalities.as_deref(),
            ) else {
                return Err(());
            };
            let tools = provider_tool_definitions_json(
                ProviderToolDefinitionTarget::OpenAiChatCompletions,
                tools,
            );
            let curl_request = OpenAiChatCompletionsCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                messages: messages.clone(),
                tools: tools.clone(),
            };
            let http_request = OpenAiChatCompletionsHttpRequestParams {
                base_url,
                api_key,
                model,
                messages,
                tools,
            };
            (
                "openai-chat-completions",
                AssistantOutputProvider::OpenAiChatCompletions,
                openai_chat_completions_http_request(&http_request),
                openai_chat_completions_curl(&curl_request),
            )
        }
        ProviderHttpRequestPlanParam::OpenaiResponses {
            base_url,
            model,
            modalities,
            reasoning,
        } => {
            let Ok(input) = openai_responses_input_from_ts_ir(&irs, modalities.as_deref()) else {
                return Err(());
            };
            let tools = provider_tool_definitions_json(
                ProviderToolDefinitionTarget::OpenAiResponses,
                tools,
            );
            let curl_request = OpenAiResponsesCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                input: input.clone(),
                instructions: system.clone(),
                tools: tools.clone(),
                reasoning: reasoning.clone(),
            };
            let http_request = OpenAiResponsesHttpRequestParams {
                base_url,
                api_key,
                model,
                input,
                instructions: system,
                tools,
                reasoning,
            };
            (
                "openai-responses",
                AssistantOutputProvider::OpenAiResponses,
                openai_responses_http_request(&http_request),
                openai_responses_curl(&curl_request),
            )
        }
        ProviderHttpRequestPlanParam::Anthropic {
            base_url,
            model,
            modalities,
            max_tokens,
            thinking,
            output_config,
        } => {
            let Ok(messages) = anthropic_messages_from_ts_ir(&irs, modalities.as_deref()) else {
                return Err(());
            };
            let tools =
                provider_tool_definitions_json(ProviderToolDefinitionTarget::Anthropic, tools);
            let curl_request = AnthropicCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                system: system.clone().unwrap_or_default(),
                messages: messages.clone(),
                tools: tools.clone(),
                max_tokens,
                thinking: thinking.clone(),
                output_config: output_config.clone(),
            };
            let http_request = AnthropicMessagesHttpRequestParams {
                base_url,
                api_key,
                model,
                system: system.unwrap_or_default(),
                messages,
                tools,
                max_tokens,
                thinking,
                output_config,
            };
            (
                "anthropic",
                AssistantOutputProvider::Anthropic,
                anthropic_messages_http_request(&http_request),
                anthropic_messages_curl(&curl_request),
            )
        }
        ProviderHttpRequestPlanParam::Gemini {
            base_url,
            model,
            modalities,
            generation_config,
        } => {
            let Ok(contents) = gemini_contents_from_ts_ir(&irs, modalities.as_deref()) else {
                return Err(());
            };
            let system_instruction = system.map(|system| {
                json!({
                    "parts": [{ "text": system }],
                })
            });
            let tools = provider_tool_definitions_json(ProviderToolDefinitionTarget::Gemini, tools);
            let curl_request = GeminiGenerateContentCurlRequest {
                base_url: base_url.clone(),
                model: model.clone(),
                contents: contents.clone(),
                system_instruction: system_instruction.clone(),
                tools: tools.clone(),
                generation_config: generation_config.clone(),
            };
            let http_request = GeminiGenerateContentHttpRequestParams {
                base_url,
                api_key,
                model,
                contents,
                system_instruction,
                tools,
                generation_config,
            };
            (
                "gemini",
                AssistantOutputProvider::Gemini,
                gemini_generate_content_http_request(&http_request),
                gemini_generate_content_curl(&curl_request),
            )
        }
    };

    Ok(result)
}

pub(in crate::agentd) fn provider_http_stream_request(
    request: &ProviderHttpRequest,
) -> ProviderHttpStreamRequest {
    ProviderHttpStreamRequest {
        method: request.method.clone(),
        url: request.url.clone(),
        headers: request
            .headers
            .iter()
            .map(|(name, value)| (name.clone(), Value::String(value.clone())))
            .collect(),
        body: request.body.clone(),
    }
}
