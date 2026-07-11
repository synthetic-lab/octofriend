use octofriend_agent::runtime::{
    AGENTD_AUTOFIX_EDIT_METHOD, AGENTD_AUTOFIX_JSON_METHOD, AGENTD_OCTO_LOWER_METHOD,
    handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

#[test]
fn octo_lower_request_returns_agentd_provider_input_irs() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "octo-lower",
        "method": AGENTD_OCTO_LOWER_METHOD,
        "params": {
            "messages": [
                {
                    "role": "user",
                    "content": [{ "type": "text", "content": "ignored before checkpoint" }]
                },
                {
                    "role": "checkpoint",
                    "content": [{ "type": "text", "content": "summary" }]
                },
                {
                    "role": "file-read",
                    "path": "image.png",
                    "content": "Image file: image.png",
                    "toolCall": {
                        "type": "tool-call",
                        "name": "read",
                        "toolCallId": "call_image",
                        "original": { "filePath": "image.png" },
                        "parsed": { "filePath": "image.png" }
                    },
                    "image": {
                        "filePath": "image.png",
                        "mimeType": "image/png",
                        "base64Data": "aW1hZ2U=",
                        "dataUrl": "data:image/png;base64,aW1hZ2U=",
                        "sizeBytes": 64
                    }
                },
                {
                    "role": "tool-reject",
                    "toolCall": {
                        "type": "tool-call",
                        "name": "edit",
                        "toolCallId": "call_rejected",
                        "original": { "filePath": "file.txt" },
                        "parsed": { "filePath": "file.txt" }
                    }
                }
            ],
            "modalities": {
                "image": {
                    "enabled": true,
                    "maxSizeMB": 1,
                    "acceptedMimeTypes": ["image/png"]
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "octo-lower");
    assert_eq!(
        value["result"]["irs"],
        json!([
            {
                "role": "lowered-checkpoint",
                "content": [{ "type": "text", "content": "summary" }]
            },
            {
                "role": "user",
                "content": [
                    { "type": "text", "content": "[Tool result for call call_image]: Image file: image.png" },
                    {
                        "type": "image",
                        "image": {
                            "filePath": "image.png",
                            "mimeType": "image/png",
                            "base64Data": "aW1hZ2U=",
                            "dataUrl": "data:image/png;base64,aW1hZ2U=",
                            "sizeBytes": 64
                        }
                    }
                ]
            },
            {
                "role": "tool-skip-output",
                "toolCall": {
                    "type": "tool-call",
                    "name": "edit",
                    "toolCallId": "call_rejected",
                    "original": { "filePath": "file.txt" },
                    "parsed": { "filePath": "file.txt" }
                },
                "reason": "Tool call rejected by user."
            }
        ])
    );
}

#[test]
fn autofix_json_request_executes_json_repair_through_agentd() {
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
        assert!(request_text.contains("\"response_format\":{\"type\":\"json_object\"}"));
        assert!(request_text.contains("broken JSON"));

        let body = json!({
            "choices": [{
                "message": {
                    "content": "{\"success\":true,\"fixed\":{\"valid\":true}}"
                }
            }],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 3
            }
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "autofix-json",
        "method": AGENTD_AUTOFIX_JSON_METHOD,
        "params": {
            "baseUrl": format!("http://{address}/v1"),
            "apiKey": "test-key",
            "model": "gpt-test",
            "brokenJson": "{\"valid\":"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "success": true,
            "fixed": { "valid": true },
            "usage": { "input": 11, "output": 3 }
        })
    );
}

#[test]
fn autofix_edit_request_executes_diff_repair_through_agentd() {
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
        assert!(request_text.contains("\"response_format\":{\"type\":\"json_object\"}"));
        assert!(request_text.contains("diff edit is invalid"));

        let body = json!({
            "choices": [{
                "message": {
                    "content": "{\"success\":true,\"search\":\"const value = 1;\"}"
                }
            }],
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 4
            }
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("test server should write response");
    });

    let line = json!({
        "jsonrpc": "2.0",
        "id": "autofix-edit",
        "method": AGENTD_AUTOFIX_EDIT_METHOD,
        "params": {
            "baseUrl": format!("http://{address}/v1"),
            "apiKey": "test-key",
            "model": "gpt-test",
            "file": "const value = 1;",
            "edit": {
                "search": "const value = 2;",
                "replace": "const value = 3;"
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    server.join().expect("test server should finish");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "success": true,
            "search": "const value = 1;",
            "usage": { "input": 12, "output": 4 }
        })
    );
}
