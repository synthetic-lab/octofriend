use octofwen_agent::runtime::{AGENTD_MODEL_CONNECTION_TEST_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

fn http_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
        body.len()
    )
}

fn sse_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\n\r\n{body}",
        body.len()
    )
}

fn start_test_server(responses: Vec<String>) -> (String, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server should expose local address");
    let server = thread::spawn(move || {
        let mut requests = Vec::new();
        for response in responses {
            let (mut stream, _) = listener
                .accept()
                .expect("test server should accept request");
            let mut request = [0_u8; 8192];
            let bytes_read = stream
                .read(&mut request)
                .expect("test server should read request");
            requests.push(String::from_utf8_lossy(&request[..bytes_read]).into_owned());
            stream
                .write_all(response.as_bytes())
                .expect("test server should write response");
        }
        requests
    });
    (format!("http://{address}/v1"), server)
}

fn model_connection_line(base_url: &str) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": "model-connection",
        "method": AGENTD_MODEL_CONNECTION_TEST_METHOD,
        "params": {
            "baseUrl": base_url,
            "apiKey": "test-key",
            "model": "gpt-test"
        }
    })
    .to_string()
}

fn typed_model_connection_line(base_url: &str, provider_type: &str, model: &str) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": "model-connection",
        "method": AGENTD_MODEL_CONNECTION_TEST_METHOD,
        "params": {
            "type": provider_type,
            "baseUrl": base_url,
            "apiKey": "test-key",
            "model": model
        }
    })
    .to_string()
}

fn gemini_model_connection_line(base_url: &str) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": "model-connection",
        "method": AGENTD_MODEL_CONNECTION_TEST_METHOD,
        "params": {
            "type": "gemini",
            "baseUrl": base_url,
            "apiKey": "test-key",
            "model": "gemini-test"
        }
    })
    .to_string()
}

#[test]
fn model_connection_test_rejects_missing_params_without_provider_http() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "model-connection",
        "method": AGENTD_MODEL_CONNECTION_TEST_METHOD
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "model-connection");
    assert_eq!(value["error"]["code"], -32602);
    assert_eq!(value["error"]["message"], "Invalid params");
}

#[test]
fn model_connection_test_executes_provider_http_and_returns_metadata() {
    let (base_url, server) = start_test_server(vec![
        http_response(
            "200 OK",
            r#"{"usage":{"prompt_tokens":5,"completion_tokens":2}}"#,
        ),
        http_response(
            "200 OK",
            r#"{"data":[{"id":"gpt-test","name":"GPT Test","context_length":8192}]}"#,
        ),
    ]);

    let response = handle_agentd_json_rpc_line(&model_connection_line(&base_url))
        .expect("request should produce response");
    let requests = server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "valid": true,
            "promptTokens": 5,
            "completionTokens": 2,
            "metadata": { "name": "GPT Test", "contextLength": 8192 }
        })
    );
    assert!(requests[0].starts_with("POST /v1/chat/completions HTTP/1.1"));
    assert!(requests[0].contains("authorization: Bearer test-key"));
    assert!(requests[0].contains("user-agent: octofriend/"));
    assert!(requests[0].contains("\"model\":\"gpt-test\""));
    assert!(requests[1].starts_with("GET /v1/models HTTP/1.1"));
}

#[test]
fn model_connection_test_executes_openai_responses_request() {
    let (base_url, server) = start_test_server(vec![http_response(
        "200 OK",
        r#"{"usage":{"input_tokens":7,"output_tokens":3}}"#,
    )]);

    let response = handle_agentd_json_rpc_line(&typed_model_connection_line(
        &base_url,
        "openai-responses",
        "gpt-test",
    ))
    .expect("request should produce response");
    let requests = server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "valid": true,
            "promptTokens": 7,
            "completionTokens": 3,
            "metadata": {}
        })
    );
    assert!(requests[0].starts_with("POST /v1/responses HTTP/1.1"));
    assert!(requests[0].contains("authorization: Bearer test-key"));
    assert!(requests[0].contains("\"model\":\"gpt-test\""));
    assert!(requests[0].contains("\"store\":false"));
    assert!(requests[0].contains("\"input\""));
    assert!(!requests[0].contains("/chat/completions"));
}

#[test]
fn model_connection_test_executes_anthropic_messages_request() {
    let (base_url, server) = start_test_server(vec![http_response(
        "200 OK",
        r#"{"usage":{"input_tokens":11,"output_tokens":5}}"#,
    )]);
    let anthropic_base_url = base_url
        .strip_suffix("/v1")
        .expect("test base URL should end with /v1");

    let response = handle_agentd_json_rpc_line(&typed_model_connection_line(
        anthropic_base_url,
        "anthropic",
        "claude-test",
    ))
    .expect("request should produce response");
    let requests = server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "valid": true,
            "promptTokens": 11,
            "completionTokens": 5,
            "metadata": {}
        })
    );
    assert!(requests[0].starts_with("POST /v1/messages HTTP/1.1"));
    assert!(requests[0].contains("x-api-key: test-key"));
    assert!(requests[0].contains("anthropic-version: 2023-06-01"));
    assert!(requests[0].contains("\"model\":\"claude-test\""));
    assert!(requests[0].contains("\"max_tokens\":16"));
    assert!(!requests[0].contains("authorization: Bearer"));
}

#[test]
fn model_connection_test_executes_native_gemini_request() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server should expose local address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("test server should accept request");
        let mut request = [0_u8; 8192];
        let bytes_read = stream
            .read(&mut request)
            .expect("test server should read request");
        let request_text = String::from_utf8_lossy(&request[..bytes_read]).into_owned();
        stream
            .write_all(
                sse_response(
                    "200 OK",
                    "data: {\"usageMetadata\":{\"promptTokenCount\":5,\"candidatesTokenCount\":2}}\n\n",
                )
                .as_bytes(),
            )
            .expect("test server should write response");
        request_text
    });

    let response = handle_agentd_json_rpc_line(&gemini_model_connection_line(&format!(
        "http://{address}/v1beta"
    )))
    .expect("request should produce response");
    let request = server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "valid": true,
            "promptTokens": 5,
            "completionTokens": 2,
            "metadata": {}
        })
    );
    assert!(
        request
            .starts_with("POST /v1beta/models/gemini-test:streamGenerateContent?alt=sse HTTP/1.1")
    );
    assert!(request.contains("x-goog-api-key: test-key"));
    assert!(!request.contains("authorization: Bearer"));
    assert!(request.contains("\"contents\":[{\"parts\":[{\"text\":\"Respond with the word 'hi' and only the word 'hi'\"}],\"role\":\"user\"}]"));
}

#[test]
fn model_connection_test_keeps_metadata_failure_non_fatal() {
    let (base_url, server) = start_test_server(vec![
        http_response(
            "200 OK",
            r#"{"usage":{"prompt_tokens":1,"completion_tokens":1}}"#,
        ),
        http_response("500 Internal Server Error", "metadata failed"),
    ]);

    let response = handle_agentd_json_rpc_line(&model_connection_line(&base_url))
        .expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "valid": true,
            "promptTokens": 1,
            "completionTokens": 1,
            "metadata": {}
        })
    );
}

#[test]
fn model_connection_test_maps_chat_http_failure_to_json_rpc_error() {
    let (base_url, server) =
        start_test_server(vec![http_response("401 Unauthorized", "invalid key")]);

    let response = handle_agentd_json_rpc_line(&model_connection_line(&base_url))
        .expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "model-connection");
    assert_eq!(value["error"]["code"], -32010);
    assert_eq!(value["error"]["message"], "invalid key");
}
