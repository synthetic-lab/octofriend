use octofwen_agent::agentd::{
    AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD, AGENTD_RENDER_TOOL_CALL_METHOD,
    handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

#[test]
fn render_tool_call_request_returns_structured_tool_render_model() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "render-1",
        "method": AGENTD_RENDER_TOOL_CALL_METHOD,
        "params": {
            "name": "shell",
            "arguments": { "cmd": "pwd", "timeout": 5000 }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "render-1");
    assert_eq!(value["result"]["kind"], "shell");
    assert_eq!(value["result"]["title"], "shell");
    assert_eq!(value["result"]["subject"], "pwd");
    assert_eq!(value["result"]["details"][0]["label"], "timeout");
    assert_eq!(value["result"]["details"][0]["value"], "5000");
}

#[test]
fn provider_compiler_complete_executes_stream_and_finishes_output_through_agentd() {
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
        assert!(request_text.contains("authorization: Bearer test-key"));
        assert!(request_text.contains("\"model\":\"gpt-test\""));

        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n",
            "data: {\"usage\":{\"prompt_tokens\":6,\"prompt_tokens_details\":{\"cached_tokens\":2},\"completion_tokens\":3}}\n\n",
            "data: [DONE]\n\n"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nx-provider-run: present\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "provider-compiler-complete",
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

    assert_eq!(value["id"], "provider-compiler-complete");
    assert_eq!(value["result"]["status"], "finished");
    assert_eq!(value["result"]["provider"], "openai-chat-completions");
    assert_eq!(value["result"]["output"]["role"], "assistant");
    assert_eq!(value["result"]["output"]["content"], "answer");
    assert_eq!(value["result"]["usage"]["input"]["cached"], 2);
    assert_eq!(value["result"]["usage"]["input"]["uncached"], 4);
    assert_eq!(value["result"]["usage"]["input"]["total"], 6);
    assert_eq!(value["result"]["usage"]["output"], 3);
    assert_eq!(value["result"]["headers"]["x-provider-run"], "present");
    assert_eq!(value["result"]["unexpectedToolCall"], false);
    assert_eq!(
        value["result"]["events"],
        json!([
            { "type": "token", "kind": "content", "text": "answer" },
            {
                "type": "usage",
                "input": 6,
                "cachedInput": 2,
                "output": 3,
                "reasoningOutput": 0
            }
        ])
    );
}

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

#[test]
fn provider_compiler_complete_autofixes_bad_tool_arguments_through_agentd() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server should expose local address");
    let server = thread::spawn(move || {
        let (mut provider_stream, _) = listener
            .accept()
            .expect("test server should accept provider request");
        let mut provider_request = [0_u8; 8192];
        let provider_bytes = provider_stream
            .read(&mut provider_request)
            .expect("test server should read provider request");
        let provider_request_text = String::from_utf8_lossy(&provider_request[..provider_bytes]);
        assert!(provider_request_text.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(provider_request_text.contains("authorization: Bearer test-key"));
        assert!(provider_request_text.contains("\"tools\""));

        let provider_body = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_bad\",\"function\":{\"name\":\"read\",\"arguments\":\"{filePath:\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let provider_response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\n\r\n{}",
            provider_body.len(),
            provider_body
        );
        provider_stream
            .write_all(provider_response.as_bytes())
            .expect("test server should write provider response");

        let (mut autofix_stream, _) = listener
            .accept()
            .expect("test server should accept autofix request");
        let mut autofix_request = [0_u8; 8192];
        let autofix_bytes = autofix_stream
            .read(&mut autofix_request)
            .expect("test server should read autofix request");
        let autofix_request_text = String::from_utf8_lossy(&autofix_request[..autofix_bytes]);
        assert!(autofix_request_text.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(autofix_request_text.contains("authorization: Bearer autofix-key"));
        assert!(autofix_request_text.contains("\"response_format\":{\"type\":\"json_object\"}"));
        assert!(autofix_request_text.contains("{filePath:"));

        let autofix_body = json!({
            "choices": [{
                "message": {
                    "content": "{\"success\":true,\"fixed\":{\"filePath\":\"README.md\"}}"
                }
            }],
            "usage": {
                "prompt_tokens": 17,
                "completion_tokens": 5
            }
        })
        .to_string();
        let autofix_response = format!(
            "HTTP/1.1 200 OK
content-type: application/json
content-length: {}

{}",
            autofix_body.len(),
            autofix_body
        );
        autofix_stream
            .write_all(autofix_response.as_bytes())
            .expect("test server should write autofix response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "provider-compiler-complete-autofix",
        "method": AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
        "params": {
            "type": "standard",
            "baseUrl": format!("http://{address}/v1"),
            "model": "gpt-test",
            "context": 128000,
            "apiKey": "test-key",
            "irs": [{ "role": "user", "content": [{ "type": "text", "content": "read file" }] }],
            "tools": [{
                "name": "read",
                "description": "Read a file",
                "schema": {
                    "type": "object",
                    "properties": { "filePath": { "type": "string" } },
                    "required": ["filePath"]
                }
            }],
            "cwd": "/workspace",
            "autofixJson": {
                "baseUrl": format!("http://{address}/v1"),
                "auth": { "type": "command", "command": ["printf", "autofix-key"] },
                "model": "gpt-autofix"
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "provider-compiler-complete-autofix");
    assert_eq!(value["result"]["status"], "finished");
    assert!(
        value["result"]["events"]
            .as_array()
            .expect("events should be an array")
            .iter()
            .any(|event| event == &json!({ "type": "autofixing-json" }))
    );
    assert_eq!(
        value["result"]["output"]["toolCalls"],
        json!([{
            "type": "tool-call",
            "name": "read",
            "toolCallId": "call_bad",
            "original": { "filePath": "README.md" },
            "parsed": { "filePath": "README.md" }
        }])
    );
}

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
    assert_eq!(
        value["result"]["curl"]
            .as_str()
            .unwrap()
            .contains("[REDACTED_API_KEY]"),
        true
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
