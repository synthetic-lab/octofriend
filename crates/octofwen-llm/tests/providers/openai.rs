use octofwen_llm::providers::ProviderHttpRequest;
use octofwen_llm::providers::openai::{
    OpenAiChatCompletionsCurlRequest, OpenAiChatCompletionsHttpRequestParams, OpenAiClientConfig,
    OpenAiCompilerError, OpenAiResponsesCurlRequest, OpenAiResponsesHttpRequestParams,
    OpenAiStatusError, openai_chat_completions_curl, openai_chat_completions_http_request,
    openai_client_config, openai_request_error, openai_responses_curl,
    openai_responses_http_request,
};
use serde_json::json;

#[test]
fn configures_base_url_api_key_and_octofriend_user_agent_header() {
    assert_eq!(
        openai_client_config("https://api.example.test/v1", "test-key", "0.8.1"),
        OpenAiClientConfig {
            base_url: "https://api.example.test/v1".into(),
            api_key: "test-key".into(),
            default_headers: vec![("User-Agent".into(), "octofriend/0.8.1".into())],
        }
    );
}

#[test]
fn maps_payment_required_status_errors_to_payment_errors() {
    let headers = vec![("x-request-id".into(), "payment".into())];

    assert_eq!(
        openai_request_error(
            "curl payment",
            OpenAiStatusError {
                status: Some(402),
                headers: headers.clone(),
                error: Some("buy credits".into()),
                fallback: "ignored".into(),
            }
        ),
        OpenAiCompilerError::PaymentError {
            request_error: "buy credits".into(),
            curl: "curl payment".into(),
            headers,
        }
    );
}

#[test]
fn maps_payment_required_status_errors_without_headers_to_payment_errors() {
    assert_eq!(
        openai_request_error(
            "curl payment no headers",
            OpenAiStatusError {
                status: Some(402),
                headers: Vec::new(),
                error: Some("buy credits".into()),
                fallback: "raw payment error".into(),
            }
        ),
        OpenAiCompilerError::PaymentError {
            request_error: "buy credits".into(),
            curl: "curl payment no headers".into(),
            headers: Vec::new(),
        }
    );
}

#[test]
fn maps_rate_limit_status_errors_to_rate_limit_errors() {
    let headers = vec![("x-request-id".into(), "limited".into())];

    assert_eq!(
        openai_request_error(
            "curl limit",
            OpenAiStatusError {
                status: Some(429),
                headers: headers.clone(),
                error: Some("slow down".into()),
                fallback: "ignored".into(),
            }
        ),
        OpenAiCompilerError::RateLimitError {
            request_error: "slow down".into(),
            curl: "curl limit".into(),
            headers,
        }
    );
}

#[test]
fn keeps_other_failures_as_request_errors_with_stringified_details() {
    assert_eq!(
        openai_request_error(
            "curl request",
            OpenAiStatusError {
                status: None,
                headers: Vec::new(),
                error: None,
                fallback: "network down".into(),
            }
        ),
        OpenAiCompilerError::RequestError {
            request_error: "network down".into(),
            curl: "curl request".into(),
            headers: Vec::new(),
        }
    );
}

#[test]
fn keeps_status_errors_without_headers_as_request_errors() {
    assert_eq!(
        openai_request_error(
            "curl no headers",
            OpenAiStatusError {
                status: Some(429),
                headers: Vec::new(),
                error: Some("slow down".into()),
                fallback: "raw error".into(),
            }
        ),
        OpenAiCompilerError::RequestError {
            request_error: "raw error".into(),
            curl: "curl no headers".into(),
            headers: Vec::new(),
        }
    );
}

#[test]
fn builds_chat_completions_curl_with_redacted_key_and_stream_usage() {
    assert_eq!(
        openai_chat_completions_curl(&OpenAiChatCompletionsCurlRequest {
            base_url: "https://api.example.test/v1".into(),
            model: "gpt-test".into(),
            messages: json!([{ "role": "user", "content": "hello" }]),
            tools: Some(json!([{ "type": "function", "function": { "name": "read" } }])),
        }),
        "curl -X POST 'https://api.example.test/v1/chat/completions' \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer [REDACTED_API_KEY]\" \\\n  -d @- <<'JSON'\n{\"messages\":[{\"content\":\"hello\",\"role\":\"user\"}],\"model\":\"gpt-test\",\"stream\":true,\"stream_options\":{\"include_usage\":true},\"tools\":[{\"function\":{\"name\":\"read\"},\"type\":\"function\"}]}\nJSON"
    );
}

#[test]
fn builds_responses_curl_with_redacted_key_and_store_disabled() {
    assert_eq!(
        openai_responses_curl(&OpenAiResponsesCurlRequest {
            base_url: "https://api.example.test/v1".into(),
            model: "gpt-test".into(),
            input: json!([{ "role": "user", "content": [{ "type": "input_text", "text": "hello" }] }]),
            instructions: Some("system prompt".into()),
            tools: Some(json!([{ "type": "function", "name": "read" }])),
            reasoning: Some(json!({ "effort": "medium", "summary": "auto" })),
        }),
        "curl -X POST 'https://api.example.test/v1/responses' \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer [REDACTED_API_KEY]\" \\\n  -d @- <<'JSON'\n{\"include\":[\"reasoning.encrypted_content\"],\"input\":[{\"content\":[{\"text\":\"hello\",\"type\":\"input_text\"}],\"role\":\"user\"}],\"instructions\":\"system prompt\",\"model\":\"gpt-test\",\"reasoning\":{\"effort\":\"medium\",\"summary\":\"auto\"},\"store\":false,\"stream\":true,\"tools\":[{\"name\":\"read\",\"type\":\"function\"}]}\nJSON"
    );
}

#[test]
fn builds_chat_completions_http_request_with_api_key_and_stream_usage() {
    assert_eq!(
        openai_chat_completions_http_request(&OpenAiChatCompletionsHttpRequestParams {
            base_url: "https://api.example.test/v1".into(),
            api_key: "test-key".into(),
            model: "gpt-test".into(),
            messages: json!([{ "role": "user", "content": "hello" }]),
            tools: Some(json!([{ "type": "function", "function": { "name": "read" } }])),
        }),
        ProviderHttpRequest {
            method: "POST".into(),
            url: "https://api.example.test/v1/chat/completions".into(),
            headers: vec![
                ("Content-Type".into(), "application/json".into()),
                ("Authorization".into(), "Bearer test-key".into()),
            ],
            body: json!({
                "messages": [{ "role": "user", "content": "hello" }],
                "model": "gpt-test",
                "stream": true,
                "stream_options": { "include_usage": true },
                "tools": [{ "type": "function", "function": { "name": "read" } }]
            }),
        }
    );
}

#[test]
fn builds_responses_http_request_with_api_key_and_store_disabled() {
    assert_eq!(
        openai_responses_http_request(&OpenAiResponsesHttpRequestParams {
            base_url: "https://api.example.test/v1".into(),
            api_key: "test-key".into(),
            model: "gpt-test".into(),
            input: json!([{ "role": "user", "content": [{ "type": "input_text", "text": "hello" }] }]),
            instructions: Some("system prompt".into()),
            tools: Some(json!([{ "type": "function", "name": "read" }])),
            reasoning: Some(json!({ "effort": "medium", "summary": "auto" })),
        }),
        ProviderHttpRequest {
            method: "POST".into(),
            url: "https://api.example.test/v1/responses".into(),
            headers: vec![
                ("Content-Type".into(), "application/json".into()),
                ("Authorization".into(), "Bearer test-key".into()),
            ],
            body: json!({
                "include": ["reasoning.encrypted_content"],
                "input": [{ "role": "user", "content": [{ "type": "input_text", "text": "hello" }] }],
                "instructions": "system prompt",
                "model": "gpt-test",
                "reasoning": { "effort": "medium", "summary": "auto" },
                "store": false,
                "stream": true,
                "tools": [{ "type": "function", "name": "read" }]
            }),
        }
    );
}
