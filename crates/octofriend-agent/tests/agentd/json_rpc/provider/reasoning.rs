use octofriend_agent::runtime::{
    AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD, handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

#[test]
fn provider_compiler_complete_passes_openai_responses_xhigh_reasoning() {
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
        assert!(request_text.starts_with("POST /v1/responses HTTP/1.1"));
        assert!(request_text.contains("authorization: Bearer test-key"));
        assert!(request_text.contains("\"model\":\"gpt-test\""));
        assert!(request_text.contains("\"reasoning\":{\"effort\":\"xhigh\",\"summary\":\"auto\"}"));

        let body = concat!(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":6,\"input_tokens_details\":{\"cached_tokens\":2},\"output_tokens\":3,\"output_tokens_details\":{\"reasoning_tokens\":1}}}}\n\n"
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
        "id": "provider-compiler-complete-openai-xhigh",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "openai-responses",
            "baseUrl": format!("http://{address}/v1"),
            "model": "gpt-test",
            "context": 128000,
            "reasoning": "xhigh",
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

    assert_eq!(value["id"], "provider-compiler-complete-openai-xhigh");
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "openai-responses");
    assert_eq!(value["result"]["output"]["content"], "answer");
    assert_eq!(value["result"]["usage"]["input"]["cached"], 2);
    assert_eq!(value["result"]["usage"]["output"], 3);
}

#[test]
fn provider_compiler_complete_passes_openai_responses_none_reasoning() {
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
        assert!(request_text.starts_with("POST /v1/responses HTTP/1.1"));
        assert!(request_text.contains("\"reasoning\":{\"effort\":\"none\",\"summary\":\"auto\"}"));

        let body = concat!(
            r#"data: {"type":"response.output_text.delta","delta":"answer"}

"#,
            r#"data: {"type":"response.completed","response":{"usage":{"input_tokens":6,"output_tokens":3}}}

"#
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
        "id": "provider-compiler-complete-openai-none",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "openai-responses",
            "baseUrl": format!("http://{address}/v1"),
            "model": "gpt-test",
            "context": 128000,
            "reasoning": "none",
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

    assert_eq!(value["id"], "provider-compiler-complete-openai-none");
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "openai-responses");
    assert_eq!(value["result"]["output"]["content"], "answer");
}

#[test]
fn provider_compiler_complete_executes_native_gemini_stream_with_tool_call() {
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
        assert!(
            request_text.starts_with(
                "POST /v1beta/models/gemini-test:streamGenerateContent?alt=sse HTTP/1.1"
            )
        );
        assert!(request_text.contains("x-goog-api-key: test-key"));
        assert!(!request_text.contains("authorization: Bearer"));
        assert!(request_text.contains("\"contents\""));
        assert!(request_text.contains("\"role\":\"user\""));
        assert!(request_text.contains("\"parts\":[{\"text\":\"hello\"}]"));
        assert!(
            request_text
                .contains("\"systemInstruction\":{\"parts\":[{\"text\":\"system prompt\"}]}")
        );
        assert!(request_text.contains("\"tools\":[{\"functionDeclarations\""));
        assert!(
            request_text
                .contains("\"generationConfig\":{\"thinkingConfig\":{\"thinkingLevel\":\"high\"}}")
        );

        let body = concat!(
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"answer\"}]}}]}\n\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"id\":\"call_gemini\",\"name\":\"read\",\"args\":{\"filePath\":\"README.md\"}}}]}}],\"usageMetadata\":{\"promptTokenCount\":7,\"cachedContentTokenCount\":2,\"candidatesTokenCount\":3,\"thoughtsTokenCount\":1}}\n\n"
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
        "id": "provider-compiler-complete-gemini",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "gemini",
            "baseUrl": format!("http://{address}/v1beta"),
            "model": "gemini-test",
            "context": 1_048_576,
            "reasoning": "xhigh",
            "apiKey": "test-key",
            "irs": [{ "role": "user", "content": [{ "type": "text", "content": "hello" }] }],
            "system": "system prompt",
            "tools": [{
                "name": "read",
                "description": "Read a file",
                "schema": {
                    "type": "object",
                    "properties": { "filePath": { "type": "string" } },
                    "required": ["filePath"]
                }
            }],
            "cwd": "/workspace"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "provider-compiler-complete-gemini");
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "gemini");
    assert_eq!(value["result"]["output"]["content"], "answer");
    assert_eq!(value["result"]["usage"]["input"]["cached"], 2);
    assert_eq!(value["result"]["usage"]["output"], 3);
    assert_eq!(
        value["result"]["output"]["toolCalls"],
        json!([{
            "type": "tool-call",
            "name": "read",
            "toolCallId": "call_gemini",
            "original": { "filePath": "README.md" },
            "parsed": { "filePath": "README.md" }
        }])
    );
}

#[test]
fn provider_compiler_complete_maps_gemini_none_reasoning_to_zero_thinking_budget() {
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
        assert!(
            request_text.starts_with(
                "POST /v1beta/models/gemini-test:streamGenerateContent?alt=sse HTTP/1.1"
            )
        );
        assert!(
            request_text
                .contains("\"generationConfig\":{\"thinkingConfig\":{\"thinkingBudget\":0}}")
        );

        let body = r#"data: {"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}

"#;
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
        "id": "provider-compiler-complete-gemini-none",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "gemini",
            "baseUrl": format!("http://{address}/v1beta"),
            "model": "gemini-test",
            "context": 1_048_576,
            "reasoning": "none",
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

    assert_eq!(value["id"], "provider-compiler-complete-gemini-none");
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "gemini");
    assert_eq!(value["result"]["output"]["content"], "answer");
}

#[test]
fn provider_compiler_complete_omits_anthropic_thinking_for_none_reasoning() {
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
        assert!(request_text.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request_text.contains("\"model\":\"claude-test\""));
        assert!(request_text.contains("\"max_tokens\":32000"));
        assert!(!request_text.contains("\"thinking\""));

        let body = concat!(
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}\n\n",
            "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}\n\n"
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
        "id": "provider-compiler-complete-anthropic-none",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "anthropic",
            "baseUrl": format!("http://{address}"),
            "model": "claude-test",
            "context": 32000,
            "reasoning": "none",
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

    assert_eq!(value["id"], "provider-compiler-complete-anthropic-none");
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "anthropic");
    assert_eq!(value["result"]["output"]["content"], "answer");
}

#[test]
fn provider_compiler_complete_uses_valid_anthropic_xhigh_budget() {
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
        assert!(request_text.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request_text.contains("\"max_tokens\":32000"));
        assert!(
            request_text.contains("\"thinking\":{\"budget_tokens\":16384,\"type\":\"enabled\"}")
        );

        let body = concat!(
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}\n\n",
            "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}\n\n"
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
        "id": "provider-compiler-complete-anthropic-xhigh",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "anthropic",
            "baseUrl": format!("http://{address}"),
            "model": "claude-test",
            "context": 32000,
            "reasoning": "xhigh",
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

    assert_eq!(value["id"], "provider-compiler-complete-anthropic-xhigh");
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "anthropic");
}

#[test]
fn provider_compiler_complete_uses_adaptive_anthropic_thinking_for_sonnet_5() {
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
        assert!(request_text.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request_text.contains("\"model\":\"claude-sonnet-5\""));
        assert!(request_text.contains("\"thinking\":{\"type\":\"adaptive\"}"));
        assert!(request_text.contains("\"output_config\":{\"effort\":\"xhigh\"}"));
        assert!(!request_text.contains("budget_tokens"));

        let body = concat!(
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}

"#,
            r#"data: {"type":"message_delta","usage":{"input_tokens":5,"output_tokens":2}}

"#
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
        "id": "provider-compiler-complete-anthropic-sonnet-5-adaptive",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "anthropic",
            "baseUrl": format!("http://{address}"),
            "model": "claude-sonnet-5",
            "context": 32000,
            "reasoning": "xhigh",
            "thinkingBudgetTokens": 12000,
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

    assert_eq!(
        value["id"],
        "provider-compiler-complete-anthropic-sonnet-5-adaptive"
    );
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "anthropic");
}

#[test]
fn provider_compiler_complete_disables_adaptive_anthropic_thinking_for_sonnet_5_none() {
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
        assert!(request_text.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request_text.contains("\"model\":\"claude-sonnet-5\""));
        assert!(request_text.contains("\"thinking\":{\"type\":\"disabled\"}"));
        assert!(!request_text.contains("\"output_config\""));
        assert!(!request_text.contains("budget_tokens"));

        let body = concat!(
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}

"#,
            r#"data: {"type":"message_delta","usage":{"input_tokens":5,"output_tokens":2}}

"#
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
        "id": "provider-compiler-complete-anthropic-sonnet-5-none",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "anthropic",
            "baseUrl": format!("http://{address}"),
            "model": "claude-sonnet-5",
            "context": 32000,
            "reasoning": "none",
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

    assert_eq!(
        value["id"],
        "provider-compiler-complete-anthropic-sonnet-5-none"
    );
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "anthropic");
}

#[test]
fn provider_compiler_complete_uses_explicit_anthropic_thinking_budget_tokens() {
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
        assert!(request_text.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request_text.contains("x-api-key: test-key"));
        assert!(request_text.contains("\"model\":\"claude-test\""));
        assert!(request_text.contains("\"max_tokens\":32000"));
        assert!(
            request_text.contains("\"thinking\":{\"budget_tokens\":12000,\"type\":\"enabled\"}")
        );

        let body = concat!(
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}\n\n",
            "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}\n\n"
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
        "id": "provider-compiler-complete-anthropic-thinking-budget",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "anthropic",
            "baseUrl": format!("http://{address}"),
            "model": "claude-test",
            "context": 32000,
            "reasoning": "high",
            "thinkingBudgetTokens": 12000,
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

    assert_eq!(
        value["id"],
        "provider-compiler-complete-anthropic-thinking-budget"
    );
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "anthropic");
    assert_eq!(value["result"]["output"]["content"], "answer");
}

#[test]
fn provider_compiler_complete_omits_anthropic_thinking_for_too_small_explicit_budget() {
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
        assert!(request_text.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request_text.contains("\"max_tokens\":32000"));
        assert!(!request_text.contains("\"thinking\""));

        let body = concat!(
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}\n\n",
            "data: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}\n\n"
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
        "id": "provider-compiler-complete-anthropic-small-thinking-budget",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "anthropic",
            "baseUrl": format!("http://{address}"),
            "model": "claude-test",
            "context": 32000,
            "thinkingBudgetTokens": 1,
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

    assert_eq!(
        value["id"],
        "provider-compiler-complete-anthropic-small-thinking-budget"
    );
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "anthropic");
}
