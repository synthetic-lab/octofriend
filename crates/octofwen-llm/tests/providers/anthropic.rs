use octofwen_llm::providers::anthropic::{
    AnthropicCurlRequest, AnthropicMessagesHttpRequestParams, anthropic_messages_curl,
    anthropic_messages_http_request,
};
use serde_json::json;

#[test]
fn builds_messages_curl_with_redacted_key_version_header_and_streaming_body() {
    assert_eq!(
        anthropic_messages_curl(&AnthropicCurlRequest {
            base_url: "https://api.anthropic.test".into(),
            model: "claude-test".into(),
            system: "system prompt".into(),
            messages: json!([{ "role": "user", "content": "hello" }]),
            tools: Some(
                json!([{ "name": "read", "description": "Read a file", "input_schema": { "type": "object" } }])
            ),
            max_tokens: 1024,
        }),
        "curl -X POST \"https://api.anthropic.test/v1/messages\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"x-api-key: [REDACTED_API_KEY]\" \\\n  -H \"anthropic-version: 2023-06-01\" \\\n  -d @- <<'JSON'\n{\"max_tokens\":1024,\"messages\":[{\"content\":\"hello\",\"role\":\"user\"}],\"model\":\"claude-test\",\"stream\":true,\"system\":\"system prompt\",\"tool_choice\":{\"disable_parallel_tool_use\":false,\"type\":\"auto\"},\"tools\":[{\"description\":\"Read a file\",\"input_schema\":{\"type\":\"object\"},\"name\":\"read\"}]}\nJSON"
    );
}

#[test]
fn builds_messages_http_request_with_api_key_version_header_and_streaming_body() {
    assert_eq!(
        anthropic_messages_http_request(&AnthropicMessagesHttpRequestParams {
            base_url: "https://api.anthropic.test".into(),
            api_key: "test-key".into(),
            model: "claude-test".into(),
            system: "system prompt".into(),
            messages: json!([{ "role": "user", "content": "hello" }]),
            tools: Some(
                json!([{ "name": "read", "description": "Read a file", "input_schema": { "type": "object" } }])
            ),
            max_tokens: 1024,
            thinking: Some(json!({ "type": "enabled", "budget_tokens": 2048 })),
        }),
        octofwen_llm::providers::ProviderHttpRequest {
            method: "POST".into(),
            url: "https://api.anthropic.test/v1/messages".into(),
            headers: vec![
                ("Content-Type".into(), "application/json".into()),
                ("x-api-key".into(), "test-key".into()),
                ("anthropic-version".into(), "2023-06-01".into()),
            ],
            body: json!({
                "max_tokens": 1024,
                "messages": [{ "role": "user", "content": "hello" }],
                "model": "claude-test",
                "stream": true,
                "system": "system prompt",
                "thinking": { "type": "enabled", "budget_tokens": 2048 },
                "tool_choice": {
                    "disable_parallel_tool_use": false,
                    "type": "auto",
                },
                "tools": [{ "name": "read", "description": "Read a file", "input_schema": { "type": "object" } }]
            }),
        }
    );
}
