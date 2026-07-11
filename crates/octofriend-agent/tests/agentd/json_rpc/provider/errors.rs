use octofriend_agent::runtime::{
    AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD, handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

#[test]
fn provider_compiler_complete_maps_payment_required_for_standard_and_anthropic_providers() {
    let standard = payment_required_provider_result(
        "provider-compiler-complete-standard-payment-error",
        "standard",
        |address| format!("http://{address}/v1"),
        "POST /v1/chat/completions HTTP/1.1",
    );
    assert_eq!(
        standard["id"],
        "provider-compiler-complete-standard-payment-error"
    );
    assert_eq!(standard["result"]["status"], "error");
    assert_eq!(standard["result"]["provider"], "openai-chat-completions");
    assert_eq!(standard["result"]["error"]["type"], "payment-error");
    assert_eq!(
        standard["result"]["error"]["requestError"],
        "payment required"
    );
    assert_eq!(standard["result"]["headers"]["x-billing-state"], "unpaid");

    let anthropic = payment_required_provider_result(
        "provider-compiler-complete-anthropic-payment-error",
        "anthropic",
        |address| format!("http://{address}"),
        "POST /v1/messages HTTP/1.1",
    );
    assert_eq!(
        anthropic["id"],
        "provider-compiler-complete-anthropic-payment-error"
    );
    assert_eq!(anthropic["result"]["status"], "error");
    assert_eq!(anthropic["result"]["provider"], "anthropic");
    assert_eq!(anthropic["result"]["error"]["type"], "payment-error");
    assert_eq!(
        anthropic["result"]["error"]["requestError"],
        "payment required"
    );
    assert_eq!(anthropic["result"]["headers"]["x-billing-state"], "unpaid");
}

fn payment_required_provider_result(
    id: &str,
    provider_type: &str,
    base_url: impl FnOnce(std::net::SocketAddr) -> String,
    expected_request_line: &'static str,
) -> serde_json::Value {
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
        let request_text = String::from_utf8_lossy(&request[..bytes_read]);
        assert!(request_text.starts_with(expected_request_line));

        let body = "payment required";
        let response = format!(
            "HTTP/1.1 402 Payment Required\r\ncontent-type: text/plain\r\nx-billing-state: unpaid\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": provider_type,
            "baseUrl": base_url(address),
            "model": "payment-test-model",
            "context": 128000,
            "apiKey": "test-key",
            "irs": [{ "role": "user", "content": [{ "type": "text", "content": "hello" }] }],
            "system": "system prompt",
            "cwd": "/workspace"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    serde_json::from_str(&response).expect("response should be json")
}

#[test]
fn provider_compiler_complete_returns_structured_request_errors_with_headers() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server should expose local address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("test server should accept request");
        let mut request = [0_u8; 8192];
        let _ = stream
            .read(&mut request)
            .expect("test server should read request");

        let body = "rate limited";
        let response = format!(
            "HTTP/1.1 429 Too Many Requests\r\ncontent-type: text/plain\r\nx-synthetic-quotas: {{\"remaining\":0}}\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "provider-compiler-complete-error",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "standard",
            "baseUrl": format!("http://{address}/v1"),
            "model": "gpt-test",
            "context": 128000,
            "apiKey": "test-key",
            "irs": [{ "role": "user", "content": [{ "type": "text", "content": "hello" }] }],
            "system": "system prompt",
            "cwd": "/workspace"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "provider-compiler-complete-error");
    assert!(value.get("error").is_none());
    assert_eq!(value["result"]["status"], "error");
    assert_eq!(value["result"]["provider"], "openai-chat-completions");
    assert_eq!(value["result"]["error"]["type"], "rate-limit-error");
    assert_eq!(value["result"]["error"]["requestError"], "rate limited");
    assert_eq!(
        value["result"]["headers"]["x-synthetic-quotas"],
        "{\"remaining\":0}"
    );
    assert!(
        value["result"]["curl"]
            .as_str()
            .unwrap()
            .contains("[REDACTED_API_KEY]")
    );
}

#[test]
fn provider_compiler_complete_returns_structured_auth_errors() {
    let value = auth_required_provider_result(
        "provider-compiler-complete-auth-error",
        "standard",
        |address| format!("http://{address}/v1"),
        "POST /v1/chat/completions HTTP/1.1",
    );

    assert_eq!(value["id"], "provider-compiler-complete-auth-error");
    assert!(value.get("error").is_none());
    assert_eq!(value["result"]["status"], "error");
    assert_eq!(value["result"]["provider"], "openai-chat-completions");
    assert_eq!(value["result"]["error"]["type"], "auth-error");
    assert_eq!(value["result"]["error"]["requestError"], "invalid api key");
}

#[test]
fn provider_compiler_complete_maps_auth_errors_for_anthropic_providers() {
    let anthropic = auth_required_provider_result(
        "provider-compiler-complete-anthropic-auth-error",
        "anthropic",
        |address| format!("http://{address}"),
        "POST /v1/messages HTTP/1.1",
    );

    assert_eq!(
        anthropic["id"],
        "provider-compiler-complete-anthropic-auth-error"
    );
    assert_eq!(anthropic["result"]["status"], "error");
    assert_eq!(anthropic["result"]["provider"], "anthropic");
    assert_eq!(anthropic["result"]["error"]["type"], "auth-error");
    assert_eq!(
        anthropic["result"]["error"]["requestError"],
        "invalid api key"
    );
}

fn auth_required_provider_result(
    id: &str,
    provider_type: &str,
    base_url: impl FnOnce(std::net::SocketAddr) -> String,
    expected_request_line: &'static str,
) -> serde_json::Value {
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
        let request_text = String::from_utf8_lossy(&request[..bytes_read]);
        assert!(request_text.starts_with(expected_request_line));

        let body = "invalid api key";
        let response = format!(
            "HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": provider_type,
            "baseUrl": base_url(address),
            "model": "auth-test-model",
            "context": 128000,
            "apiKey": "bad-key",
            "irs": [{ "role": "user", "content": [{ "type": "text", "content": "hello" }] }],
            "system": "system prompt",
            "cwd": "/workspace"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    serde_json::from_str(&response).expect("response should be json")
}

#[test]
fn provider_compiler_complete_preserves_headers_on_stream_parse_errors() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server should expose local address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("test server should accept request");
        let mut request = [0_u8; 8192];
        let _ = stream
            .read(&mut request)
            .expect("test server should read request");

        let body = "data: {not-json}\r\n\r\n";
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nx-synthetic-quotas: {{\"remaining\":1}}\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "provider-compiler-complete-parse-error",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "standard",
            "baseUrl": format!("http://{address}/v1"),
            "model": "gpt-test",
            "context": 128000,
            "apiKey": "test-key",
            "irs": [{ "role": "user", "content": [{ "type": "text", "content": "hello" }] }],
            "cwd": "/workspace"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "provider-compiler-complete-parse-error");
    assert_eq!(value["result"]["status"], "error");
    assert_eq!(
        value["result"]["headers"]["x-synthetic-quotas"],
        "{\"remaining\":1}"
    );
    assert!(
        value["result"]["error"]["requestError"]
            .as_str()
            .unwrap()
            .contains("Invalid provider stream JSON event")
    );
}

#[test]
fn provider_compiler_complete_returns_unexpected_tool_call_error_when_tools_are_disabled() {
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
        let request_text = String::from_utf8_lossy(&request[..bytes_read]);
        assert!(request_text.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(!request_text.contains("\"tools\""));

        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"read\",\"arguments\":\"{}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "provider-compiler-unexpected-tool",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "standard",
            "baseUrl": format!("http://{address}/v1"),
            "model": "gpt-test",
            "context": 128000,
            "apiKey": "test-key",
            "irs": [{ "role": "user", "content": [{ "type": "text", "content": "hello" }] }],
            "system": "system prompt",
            "cwd": "/workspace"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "provider-compiler-unexpected-tool");
    assert_eq!(value["result"]["status"], "error");
    assert_eq!(value["result"]["unexpectedToolCall"], true);
    assert_eq!(value["result"]["error"]["type"], "unexpected-tool-call");
}
