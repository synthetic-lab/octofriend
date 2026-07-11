use octofriend_models::providers::ProviderHttpRequest;
use octofriend_models::providers::gemini::{
    GeminiGenerateContentCurlRequest, GeminiGenerateContentHttpRequestParams,
    gemini_generate_content_curl, gemini_generate_content_http_request,
};
use serde_json::json;

#[test]
fn builds_generate_content_curl_with_redacted_key_and_streaming_body() {
    assert_eq!(
        gemini_generate_content_curl(&GeminiGenerateContentCurlRequest {
            base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
            model: "gemini-test".into(),
            contents: json!([{ "role": "user", "parts": [{ "text": "hello" }] }]),
            system_instruction: Some(json!({ "parts": [{ "text": "system prompt" }] })),
            tools: Some(json!([{ "functionDeclarations": [{ "name": "read" }] }])),
            generation_config: None,
        }),
        "curl -X POST 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse' \\\n  -H \"Content-Type: application/json\" \\\n  -H \"x-goog-api-key: [REDACTED_API_KEY]\" \\\n  -d @- <<'JSON'\n{\"contents\":[{\"parts\":[{\"text\":\"hello\"}],\"role\":\"user\"}],\"systemInstruction\":{\"parts\":[{\"text\":\"system prompt\"}]},\"tools\":[{\"functionDeclarations\":[{\"name\":\"read\"}]}]}\nJSON"
    );
}

#[test]
fn builds_generate_content_http_request_with_google_api_key_header() {
    assert_eq!(
        gemini_generate_content_http_request(&GeminiGenerateContentHttpRequestParams {
            base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
            api_key: "test-key".into(),
            model: "gemini-test".into(),
            contents: json!([{ "role": "user", "parts": [{ "text": "hello" }] }]),
            system_instruction: Some(json!({ "parts": [{ "text": "system prompt" }] })),
            tools: Some(
                json!([{ "functionDeclarations": [{ "name": "read", "parameters": { "type": "object" } }] }])
            ),
            generation_config: Some(json!({
                "thinkingConfig": { "thinkingLevel": "low" }
            })),
        }),
        ProviderHttpRequest {
            method: "POST".into(),
            url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse".into(),
            headers: vec![
                ("Content-Type".into(), "application/json".into()),
                ("x-goog-api-key".into(), "test-key".into()),
            ],
            body: json!({
                "contents": [{ "role": "user", "parts": [{ "text": "hello" }] }],
                "systemInstruction": { "parts": [{ "text": "system prompt" }] },
                "tools": [{ "functionDeclarations": [{ "name": "read", "parameters": { "type": "object" } }] }],
                "generationConfig": { "thinkingConfig": { "thinkingLevel": "low" } }
            }),
        }
    );
}
