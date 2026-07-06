use octofwen_agent::agentd::{AGENTD_TRAJECTORY_FINISH_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn trajectory_finish_request_returns_agentd_malformed_tool_retry() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-finish-malformed",
        "method": AGENTD_TRAJECTORY_FINISH_METHOD,
        "params": {
            "irs": [{
                "role": "user",
                "content": [{ "type": "text", "content": "hello" }]
            }],
            "assistantMessage": {
                "role": "assistant",
                "content": "",
                "usage": {
                    "input": { "cached": 0, "uncached": 0, "total": 0 },
                    "output": 0
                },
                "toolCalls": [
                    {
                        "type": "tool-call",
                        "name": "read",
                        "toolCallId": "call_valid",
                        "original": { "filePath": "README.md" },
                        "parsed": { "filePath": "README.md" }
                    },
                    {
                        "type": "malformed-tool-request",
                        "error": "Bad JSON",
                        "toolCallId": "call_bad",
                        "originalName": "edit",
                        "originalArguments": { "filePath": 42 }
                    }
                ]
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    let expected_irs = json!([
        {
            "role": "user",
            "content": [{ "type": "text", "content": "hello" }]
        },
        {
            "role": "assistant",
            "content": "",
            "usage": {
                "input": { "cached": 0, "uncached": 0, "total": 0 },
                "output": 0
            },
            "toolCalls": [
                {
                    "type": "tool-call",
                    "name": "read",
                    "toolCallId": "call_valid",
                    "original": { "filePath": "README.md" },
                    "parsed": { "filePath": "README.md" }
                },
                {
                    "type": "malformed-tool-request",
                    "error": "Bad JSON",
                    "toolCallId": "call_bad",
                    "originalName": "edit",
                    "originalArguments": { "filePath": 42 }
                }
            ]
        },
        {
            "role": "tool-skip-output",
            "toolCall": {
                "type": "tool-call",
                "name": "read",
                "toolCallId": "call_valid",
                "original": { "filePath": "README.md" },
                "parsed": { "filePath": "README.md" }
            },
            "reason": "Another tool call in this batch was malformed, so this tool call was skipped"
        },
        {
            "role": "tool-parse-error",
            "malformedRequest": {
                "type": "malformed-tool-request",
                "error": "Bad JSON",
                "toolCallId": "call_bad",
                "originalName": "edit",
                "originalArguments": { "filePath": 42 }
            }
        }
    ]);

    assert_eq!(value["id"], "trajectory-finish-malformed");
    assert_eq!(
        value["result"]["reason"],
        json!({ "type": "needs-response" })
    );
    assert_eq!(value["result"]["irs"], expected_irs);
    assert_eq!(
        value["result"]["events"],
        json!([{ "type": "retry-tool", "irs": expected_irs }])
    );
}

#[test]
fn trajectory_finish_request_returns_agentd_validation_retry() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-finish-validation-retry",
        "method": AGENTD_TRAJECTORY_FINISH_METHOD,
        "params": {
            "irs": [{
                "role": "assistant",
                "content": "",
                "usage": {
                    "input": { "cached": 0, "uncached": 0, "total": 0 },
                    "output": 0
                },
                "toolCalls": [{
                    "type": "tool-call",
                    "name": "read",
                    "toolCallId": "call_invalid",
                    "original": { "filePath": "missing.md" },
                    "parsed": { "filePath": "missing.md" }
                }]
            }],
            "toolCalls": [{
                "type": "tool-call",
                "name": "read",
                "toolCallId": "call_invalid",
                "original": { "filePath": "missing.md" },
                "parsed": { "filePath": "missing.md" }
            }],
            "retryIrs": [{
                "role": "tool-validation-error",
                "toolCall": {
                    "type": "tool-call",
                    "name": "read",
                    "toolCallId": "call_invalid",
                    "original": { "filePath": "missing.md" },
                    "parsed": { "filePath": "missing.md" }
                },
                "error": "missing.md couldn't be read",
                "aborted": false
            }]
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    let expected_irs = json!([
        {
            "role": "assistant",
            "content": "",
            "usage": {
                "input": { "cached": 0, "uncached": 0, "total": 0 },
                "output": 0
            },
            "toolCalls": [{
                "type": "tool-call",
                "name": "read",
                "toolCallId": "call_invalid",
                "original": { "filePath": "missing.md" },
                "parsed": { "filePath": "missing.md" }
            }]
        },
        {
            "role": "tool-validation-error",
            "toolCall": {
                "type": "tool-call",
                "name": "read",
                "toolCallId": "call_invalid",
                "original": { "filePath": "missing.md" },
                "parsed": { "filePath": "missing.md" }
            },
            "error": "missing.md couldn't be read",
            "aborted": false
        }
    ]);

    assert_eq!(value["id"], "trajectory-finish-validation-retry");
    assert_eq!(value["result"]["irs"], expected_irs);
    assert_eq!(
        value["result"]["reason"],
        json!({ "type": "needs-response" })
    );
    assert_eq!(
        value["result"]["events"],
        json!([{ "type": "retry-tool", "irs": expected_irs }])
    );
}

#[test]
fn trajectory_finish_request_shapes_tool_validation_results_through_agentd() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-finish-validation-results",
        "method": AGENTD_TRAJECTORY_FINISH_METHOD,
        "params": {
            "irs": [{
                "role": "assistant",
                "content": "",
                "usage": {
                    "input": { "cached": 0, "uncached": 0, "total": 0 },
                    "output": 0
                },
                "toolCalls": [
                    {
                        "type": "tool-call",
                        "name": "read",
                        "toolCallId": "call_valid",
                        "original": { "filePath": "README.md" },
                        "parsed": { "filePath": "README.md" }
                    },
                    {
                        "type": "tool-call",
                        "name": "edit",
                        "toolCallId": "call_invalid",
                        "original": { "filePath": "missing.md" },
                        "parsed": { "filePath": "missing.md" }
                    }
                ]
            }],
            "toolCalls": [
                {
                    "type": "tool-call",
                    "name": "read",
                    "toolCallId": "call_valid",
                    "original": { "filePath": "README.md" },
                    "parsed": { "filePath": "README.md" }
                },
                {
                    "type": "tool-call",
                    "name": "edit",
                    "toolCallId": "call_invalid",
                    "original": { "filePath": "missing.md" },
                    "parsed": { "filePath": "missing.md" }
                }
            ],
            "validationResults": [
                { "status": "valid" },
                { "status": "error", "message": "missing.md couldn't be edited", "aborted": false }
            ]
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    let expected_irs = json!([
        {
            "role": "assistant",
            "content": "",
            "usage": {
                "input": { "cached": 0, "uncached": 0, "total": 0 },
                "output": 0
            },
            "toolCalls": [
                {
                    "type": "tool-call",
                    "name": "read",
                    "toolCallId": "call_valid",
                    "original": { "filePath": "README.md" },
                    "parsed": { "filePath": "README.md" }
                },
                {
                    "type": "tool-call",
                    "name": "edit",
                    "toolCallId": "call_invalid",
                    "original": { "filePath": "missing.md" },
                    "parsed": { "filePath": "missing.md" }
                }
            ]
        },
        {
            "role": "tool-skip-output",
            "toolCall": {
                "type": "tool-call",
                "name": "read",
                "toolCallId": "call_valid",
                "original": { "filePath": "README.md" },
                "parsed": { "filePath": "README.md" }
            },
            "reason": "One of your other tool calls was invalid, so no tool calls were run"
        },
        {
            "role": "tool-validation-error",
            "toolCall": {
                "type": "tool-call",
                "name": "edit",
                "toolCallId": "call_invalid",
                "original": { "filePath": "missing.md" },
                "parsed": { "filePath": "missing.md" }
            },
            "error": "missing.md couldn't be edited",
            "aborted": false
        }
    ]);

    assert_eq!(value["id"], "trajectory-finish-validation-results");
    assert_eq!(value["result"]["irs"], expected_irs);
    assert_eq!(
        value["result"]["reason"],
        json!({ "type": "needs-response" })
    );
    assert_eq!(
        value["result"]["events"],
        json!([{ "type": "retry-tool", "irs": expected_irs }])
    );
}

#[test]
fn trajectory_finish_request_maps_compiler_errors_and_quota_events_through_agentd() {
    let error_line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-finish-error",
        "method": AGENTD_TRAJECTORY_FINISH_METHOD,
        "params": {
            "irs": [],
            "compilerError": {
                "type": "stream-error",
                "requestError": "stream failed",
                "curl": "curl stream"
            }
        }
    })
    .to_string();

    let error_response =
        handle_agentd_json_rpc_line(&error_line).expect("request should produce response");
    let error_value: serde_json::Value =
        serde_json::from_str(&error_response).expect("response should be json");

    assert_eq!(error_value["id"], "trajectory-finish-error");
    assert_eq!(error_value["result"]["irs"], json!([]));
    assert_eq!(
        error_value["result"]["reason"],
        json!({
            "type": "request-error",
            "requestError": "stream failed",
            "curl": "curl stream"
        })
    );
    assert_eq!(error_value["result"]["events"], json!([]));

    let quota_line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-finish-quota",
        "method": AGENTD_TRAJECTORY_FINISH_METHOD,
        "params": {
            "irs": [],
            "headers": {
                "X-Synthetic-Quotas": "{\"rollingFiveHourLimit\":{\"remaining\":3,\"max\":4,\"nextTickAt\":\"2026-01-02T03:04:05Z\",\"tickPercent\":75},\"weeklyTokenLimit\":null}"
            }
        }
    })
    .to_string();

    let quota_response =
        handle_agentd_json_rpc_line(&quota_line).expect("request should produce response");
    let quota_value: serde_json::Value =
        serde_json::from_str(&quota_response).expect("response should be json");

    assert_eq!(quota_value["id"], "trajectory-finish-quota");
    assert_eq!(quota_value["result"]["irs"], json!([]));
    assert_eq!(
        quota_value["result"]["reason"],
        json!({ "type": "needs-response" })
    );
    assert_eq!(
        quota_value["result"]["events"],
        json!([{
            "type": "quota-updated",
            "quota": {
                "rollingFiveHourLimit": {
                    "remaining": 3.0,
                    "max": 4.0,
                    "nextTickAt": "2026-01-02T03:04:05Z",
                    "tickPercent": 75.0
                }
            }
        }])
    );
}

#[test]
fn trajectory_finish_request_returns_agentd_buffered_assistant_irs() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-finish-buffer",
        "method": AGENTD_TRAJECTORY_FINISH_METHOD,
        "params": {
            "irs": [{
                "role": "checkpoint",
                "content": [{ "type": "text", "content": "summary" }]
            }],
            "buffer": {
                "content": "partial answer",
                "reasoning": "partial reasoning",
                "tool": "partial tool json"
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "trajectory-finish-buffer");
    assert_eq!(
        value["result"],
        json!({
            "irs": [
                {
                    "role": "checkpoint",
                    "content": [{ "type": "text", "content": "summary" }]
                },
                {
                    "role": "assistant",
                    "content": "partial answer",
                    "reasoningContent": "partial reasoning",
                    "usage": {
                        "input": { "cached": 0, "uncached": 0, "total": 0 },
                        "output": 0
                    }
                }
            ],
            "reason": { "type": "needs-response" },
            "events": []
        })
    );
}

#[test]
fn trajectory_arc_auto_compacts_before_main_provider_request() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::{Duration, Instant};

    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server should expose local address");
    listener
        .set_nonblocking(true)
        .expect("test server should accept nonblocking mode");
    let server = thread::spawn(move || {
        let mut requests = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        for response_text in ["summary", "answer"] {
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < deadline,
                            "timed out waiting for provider request {}",
                            requests.len() + 1
                        );
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("test server should accept request: {error}"),
                }
            };
            let mut request = [0_u8; 16384];
            let bytes_read = stream
                .read(&mut request)
                .expect("test server should read request");
            requests.push(String::from_utf8_lossy(&request[..bytes_read]).to_string());

            let body = format!(
                "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{response_text}\"}}}}]}}\n\ndata: {{\"usage\":{{\"prompt_tokens\":6,\"completion_tokens\":3}}}}\n\ndata: [DONE]\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("test server should write response");
        }
        requests
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-arc-compaction",
        "method": octofwen_agent::agentd::AGENTD_TRAJECTORY_ARC_METHOD,
        "params": {
            "cwd": ".",
            "apiKey": "test-key",
            "model": {
                "type": "standard",
                "baseUrl": format!("http://{address}/v1"),
                "model": "gpt-test",
                "context": 10
            },
            "messages": [
                { "role": "assistant", "content": "prior", "usage": { "input": { "cached": 0, "uncached": 10, "total": 10 }, "output": 10 } },
                { "role": "user", "content": [{ "type": "text", "content": "continue" }] }
            ],
            "config": { "yourName": "Test User" }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let requests = server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(requests.len(), 2);
    assert!(requests[0].contains("Generate a summary of everything"));
    assert!(requests[1].contains("Conversation History Summary"));
    assert!(requests[1].contains("summary"));
    assert_eq!(value["id"], "trajectory-arc-compaction");
    assert_eq!(
        value["result"]["reason"],
        json!({ "type": "needs-response" })
    );
    assert_eq!(value["result"]["irs"][0]["role"], "checkpoint");
    assert_eq!(value["result"]["irs"][1]["role"], "assistant");
    assert_eq!(value["result"]["irs"][1]["content"], "answer");
    assert_eq!(
        value["result"]["events"]
            .as_array()
            .expect("events should be array")
            .iter()
            .filter_map(|event| event.get("type").and_then(serde_json::Value::as_str))
            .collect::<Vec<_>>(),
        vec![
            "start-compaction",
            "compaction-progress",
            "token-usage",
            "compaction-parsed",
            "start-response",
            "response-progress",
            "token-usage"
        ]
    );
}

#[test]
fn trajectory_arc_preserves_compaction_events_on_compaction_error() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
    let address = listener
        .local_addr()
        .expect("test server should expose local address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("test server should accept compaction request");
        let mut request = [0_u8; 8192];
        let _ = stream
            .read(&mut request)
            .expect("test server should read request");
        let body = "compaction failed";
        let response = format!(
            "HTTP/1.1 500 Internal Server Error\r\ncontent-type: text/plain\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-arc-compaction-error",
        "method": octofwen_agent::agentd::AGENTD_TRAJECTORY_ARC_METHOD,
        "params": {
            "cwd": ".",
            "apiKey": "test-key",
            "model": {
                "type": "standard",
                "baseUrl": format!("http://{address}/v1"),
                "model": "gpt-test",
                "context": 10
            },
            "messages": [{
                "role": "assistant",
                "content": "prior",
                "usage": { "input": { "cached": 0, "uncached": 10, "total": 10 }, "output": 10 }
            }],
            "config": { "yourName": "Test User" }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "trajectory-arc-compaction-error");
    assert_eq!(value["result"]["reason"]["type"], "compaction-error");
    assert_eq!(
        value["result"]["events"],
        json!([{ "type": "start-compaction" }])
    );
}

#[test]
fn trajectory_arc_request_returns_abort_without_provider_execution() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "trajectory-arc-abort",
        "method": octofwen_agent::agentd::AGENTD_TRAJECTORY_ARC_METHOD,
        "params": {
            "cwd": ".",
            "apiKey": "unused",
            "model": {
                "baseUrl": "https://example.invalid/v1",
                "model": "gpt-test",
                "context": 1000
            },
            "messages": [],
            "config": { "yourName": "Test User" },
            "aborted": true
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "trajectory-arc-abort");
    assert_eq!(
        value["result"],
        json!({
            "type": "finish",
            "irs": [],
            "reason": { "type": "abort" },
            "events": []
        })
    );
}
