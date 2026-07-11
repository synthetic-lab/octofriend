use env as safe_env;
use octofriend_agent::runtime::{
    A2A_GET_TASK_METHOD, A2A_SEND_MESSAGE_METHOD, ACP_INITIALIZE_METHOD, ACP_SESSION_NEW_METHOD,
    ACP_SESSION_PROMPT_METHOD, AGENTD_INITIALIZE_METHOD, AGENTD_SYSTEM_PROMPT_METHOD,
    AgentdJsonRpcHandler, handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[test]
fn stateful_handler_tracks_acp_sessions_and_a2a_tasks() {
    let mut handler = AgentdJsonRpcHandler::default();
    let unknown_prompt = json!({
        "jsonrpc": "2.0",
        "id": "unknown-prompt",
        "method": ACP_SESSION_PROMPT_METHOD,
        "params": {
            "sessionId": "octofriend:/missing",
            "prompt": [{ "type": "text", "text": "hello" }]
        }
    })
    .to_string();
    let response = handler
        .handle_line(&unknown_prompt)
        .expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    assert_eq!(value["error"]["message"], "Unknown session");

    let new_session = json!({
        "jsonrpc": "2.0",
        "id": "tracked-session",
        "method": ACP_SESSION_NEW_METHOD,
        "params": {
            "cwd": "/repo",
            "mcpServers": []
        }
    })
    .to_string();
    let response = handler
        .handle_line(&new_session)
        .expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    assert_eq!(value["result"]["sessionId"], "octofriend:/repo");

    let prompt = json!({
        "jsonrpc": "2.0",
        "id": "tracked-prompt",
        "method": ACP_SESSION_PROMPT_METHOD,
        "params": {
            "sessionId": "octofriend:/repo",
            "prompt": [{ "type": "text", "text": "hello" }]
        }
    })
    .to_string();
    let response = handler
        .handle_line(&prompt)
        .expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    assert_eq!(value["result"]["stopReason"], "end_turn");

    let message = json!({
        "jsonrpc": "2.0",
        "id": "a2a-track",
        "method": A2A_SEND_MESSAGE_METHOD,
        "params": {
            "message": {
                "messageId": "message-2",
                "taskId": "task-2",
                "contextId": "context-2",
                "role": "ROLE_USER",
                "parts": [{ "text": "Track me" }]
            }
        }
    })
    .to_string();
    handler
        .handle_line(&message)
        .expect("request should produce response");
    let get_task = json!({
        "jsonrpc": "2.0",
        "id": "get-task",
        "method": A2A_GET_TASK_METHOD,
        "params": { "id": "task-2" }
    })
    .to_string();
    let response = handler
        .handle_line(&get_task)
        .expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    assert_eq!(value["result"]["task"]["id"], "task-2");
    assert_eq!(
        value["result"]["task"]["status"]["state"],
        "TASK_STATE_COMPLETED"
    );
}

#[test]
fn a2a_send_message_accepts_field_presence_message_shape() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "a2a-message",
        "method": A2A_SEND_MESSAGE_METHOD,
        "params": {
            "message": {
                "messageId": "message-1",
                "contextId": "context-1",
                "role": "ROLE_USER",
                "parts": [{ "text": "Summarize repo" }]
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "a2a-message");
    assert_eq!(value["result"]["message"]["role"], "ROLE_AGENT");
    assert_eq!(
        value["result"]["message"]["messageId"],
        "message-1:response"
    );
    assert_eq!(value["result"]["message"]["contextId"], "context-1");
    assert_eq!(
        value["result"]["message"]["parts"],
        json!([{ "text": "Accepted by octofriend-agentd" }])
    );
}

#[test]
fn a2a_send_message_runs_octofriend_trajectory_extension() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "a2a-trajectory",
        "method": A2A_SEND_MESSAGE_METHOD,
        "params": {
            "message": {
                "messageId": "message-trajectory",
                "role": "ROLE_USER",
                "parts": [{ "text": "Summarize repo" }]
            },
            "octofriendTrajectory": aborted_trajectory_params()
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "a2a-trajectory");
    assert_eq!(
        value["result"]["message"]["parts"],
        json!([{ "text": "octofriend trajectory finished with abort" }])
    );
    assert_eq!(
        value["result"]["octofriendTrajectory"]["reason"],
        json!({ "type": "abort" })
    );
}

#[test]
fn a2a_send_message_rejects_missing_message_id() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "a2a-bad-message",
        "method": A2A_SEND_MESSAGE_METHOD,
        "params": {
            "message": {
                "role": "ROLE_USER",
                "parts": [{ "text": "Summarize repo" }]
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "a2a-bad-message");
    assert_eq!(value["error"]["code"], -32602);
    assert_eq!(value["error"]["message"], "Invalid params");
}

#[test]
fn acp_initialize_request_returns_agent_capabilities() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "acp-init",
        "method": ACP_INITIALIZE_METHOD,
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": true }
            },
            "clientInfo": { "name": "test-client", "version": "0.0.0" }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "acp-init");
    assert_eq!(value["result"]["protocolVersion"], 1);
    assert_eq!(value["result"]["agentInfo"]["name"], "octofriend-agentd");
    assert_eq!(value["result"]["agentCapabilities"]["loadSession"], false);
}

#[test]
fn acp_session_new_and_prompt_accept_protocol_shapes() {
    let new_session = json!({
        "jsonrpc": "2.0",
        "id": "new-session",
        "method": ACP_SESSION_NEW_METHOD,
        "params": {
            "cwd": "/repo",
            "additionalDirectories": ["/repo/packages"],
            "mcpServers": []
        }
    })
    .to_string();
    let response =
        handle_agentd_json_rpc_line(&new_session).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    assert_eq!(value["id"], "new-session");
    assert_eq!(value["result"]["sessionId"], "octofriend:/repo");

    let prompt = json!({
        "jsonrpc": "2.0",
        "id": "prompt",
        "method": ACP_SESSION_PROMPT_METHOD,
        "params": {
            "sessionId": "octofriend:/repo",
            "prompt": [{ "type": "text", "text": "hello" }]
        }
    })
    .to_string();
    let response = handle_agentd_json_rpc_line(&prompt).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    assert_eq!(value["id"], "prompt");
    assert_eq!(value["result"]["stopReason"], "end_turn");
}

#[test]
fn acp_session_prompt_runs_octofriend_trajectory_extension() {
    let mut handler = AgentdJsonRpcHandler::default();
    let new_session = json!({
        "jsonrpc": "2.0",
        "id": "new-session-for-trajectory",
        "method": ACP_SESSION_NEW_METHOD,
        "params": {
            "cwd": "/repo",
            "mcpServers": []
        }
    })
    .to_string();
    handler
        .handle_line(&new_session)
        .expect("request should produce response");

    let prompt = json!({
        "jsonrpc": "2.0",
        "id": "prompt-trajectory",
        "method": ACP_SESSION_PROMPT_METHOD,
        "params": {
            "sessionId": "octofriend:/repo",
            "prompt": [{ "type": "text", "text": "hello" }],
            "_meta": {
                "octofriend": {
                    "trajectoryArc": aborted_trajectory_params()
                }
            }
        }
    })
    .to_string();
    let response = handler
        .handle_line(&prompt)
        .expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "prompt-trajectory");
    assert_eq!(value["result"]["stopReason"], "end_turn");
    assert_eq!(
        value["result"]["octofriendTrajectory"]["reason"],
        json!({ "type": "abort" })
    );
}

fn aborted_trajectory_params() -> serde_json::Value {
    json!({
        "cwd": "/repo",
        "apiKey": "test-key",
        "model": {
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-test",
            "context": 128
        },
        "messages": [],
        "config": {
            "yourName": "Tester"
        },
        "aborted": true
    })
}

#[test]
fn initialize_request_returns_agentd_capabilities() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": AGENTD_INITIALIZE_METHOD
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["jsonrpc"], "2.0");
    assert_eq!(value["id"], 1);
    assert_eq!(value["result"]["serverInfo"]["name"], "octofriend-agentd");
    assert_eq!(value["result"]["capabilities"]["renderModels"], true);
}

#[test]
fn system_prompt_request_returns_agentd_prompt() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "system-prompt",
        "method": AGENTD_SYSTEM_PROMPT_METHOD,
        "params": {
            "userName": "Krystian",
            "workingDirectory": "/home/krystian/project",
            "directoryEntries": [
                { "entry": "package.json", "isDirectory": false },
                { "entry": "source", "isDirectory": true }
            ],
            "mcpPrompt": "",
            "instructionPrompt": "# Instructions from Krystian\n<instruction path=\"/home/krystian/project/AGENTS.md\">Use Bun &amp; &lt;escape&gt;</instruction>"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "system-prompt");
    let prompt = value["result"]["prompt"]
        .as_str()
        .expect("prompt should be a string");
    assert!(prompt.contains("The user's name is Krystian"));
    assert!(prompt.contains("Your current working directory is: /home/krystian/project"));
    assert!(prompt.contains(r#"{"entry":"package.json","isDirectory":false}"#));
    assert!(prompt.contains(r#"{"entry":"source","isDirectory":true}"#));
    assert!(prompt.contains("# Instructions from Krystian"));
    assert!(
        prompt.contains(
            r#"<instruction path="/home/krystian/project/AGENTS.md">Use Bun &amp; &lt;escape&gt;</instruction>"#
        )
    );
}

#[test]
fn system_prompt_request_discovers_workspace_context_through_agentd() {
    let original_dir = safe_env::current_dir().expect("current dir should be available");
    let temp_dir = safe_env::temp_dir().join(format!(
        "octofriend-agent-system-prompt-{}-{}",
        std::process::id(),
        NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    fs::create_dir_all(temp_dir.join(".agents")).expect("agents dir should be created");
    fs::write(temp_dir.join("AGENTS.md"), "Use Bun & <escape>")
        .expect("instruction file should be written");
    fs::write(
        temp_dir.join(".agents").join("AGENTS.md"),
        "Use project agents",
    )
    .expect("agents directory instruction file should be written");
    fs::write(temp_dir.join("CLAUDE.md"), "Use Claude hints")
        .expect("claude instruction file should be written");
    fs::write(temp_dir.join("package.json"), "{}").expect("package file should be written");
    let temp_dir = fs::canonicalize(&temp_dir).expect("temp dir should canonicalize");

    safe_env::set_current_dir(&temp_dir).expect("temp dir should become cwd");
    let line = json!({
        "jsonrpc": "2.0",
        "id": "system-prompt-discovery",
        "method": AGENTD_SYSTEM_PROMPT_METHOD,
        "params": {
            "userName": "Krystian",
            "mcpPrompt": ""
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    safe_env::set_current_dir(original_dir).expect("original cwd should be restored");
    fs::remove_dir_all(&temp_dir).expect("temp dir should be removed");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "system-prompt-discovery");
    let prompt = value["result"]["prompt"]
        .as_str()
        .expect("prompt should be a string");
    assert!(prompt.contains(&format!(
        "Your current working directory is: {}",
        temp_dir.display()
    )));
    assert!(prompt.contains(r#"{"entry":"AGENTS.md","isDirectory":false}"#));
    assert!(prompt.contains(r#"{"entry":"package.json","isDirectory":false}"#));
    assert!(prompt.contains("# Instructions from Krystian"));
    assert!(prompt.contains(r#"<instruction path=""#));
    assert!(prompt.contains("Use Bun &amp; &lt;escape&gt;"));
    assert!(prompt.contains("Use project agents"));
    assert!(prompt.contains("Use Claude hints"));
    let agents_index = prompt
        .find("Use Bun &amp; &lt;escape&gt;")
        .expect("AGENTS.md instructions should be present");
    let agents_directory_index = prompt
        .find("Use project agents")
        .expect(".agents/AGENTS.md instructions should be present");
    let claude_index = prompt
        .find("Use Claude hints")
        .expect("CLAUDE.md instructions should be present");
    assert!(agents_index < agents_directory_index);
    assert!(agents_directory_index < claude_index);
}

#[test]
fn system_prompt_discovers_gitignore_aware_directory_hierarchy() {
    let temp_dir = safe_env::temp_dir().join(format!(
        "octofriend-agent-system-prompt-hierarchy-{}-{}",
        std::process::id(),
        NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(temp_dir.join("src").join("nested"))
        .expect("src nested dir should be created");
    fs::create_dir_all(temp_dir.join("target").join("debug"))
        .expect("ignored target dir should be created");
    fs::create_dir_all(temp_dir.join(".git")).expect("git dir should be created");
    fs::write(temp_dir.join(".gitignore"), "target/\n*.log\n")
        .expect("gitignore should be written");
    fs::write(temp_dir.join("src").join("main.rs"), "fn main() {}")
        .expect("source file should be written");
    fs::write(
        temp_dir.join("src").join("nested").join("mod.rs"),
        "pub mod nested;",
    )
    .expect("nested source file should be written");
    fs::write(
        temp_dir.join("target").join("debug").join("artifact"),
        "ignored",
    )
    .expect("ignored artifact should be written");
    fs::write(temp_dir.join("debug.log"), "ignored").expect("ignored log should be written");
    let temp_dir = fs::canonicalize(&temp_dir).expect("temp dir should canonicalize");

    let line = json!({
        "jsonrpc": "2.0",
        "id": "system-prompt-hierarchy",
        "method": AGENTD_SYSTEM_PROMPT_METHOD,
        "params": {
            "userName": "Krystian",
            "workingDirectory": temp_dir,
            "mcpPrompt": ""
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    fs::remove_dir_all(&temp_dir).expect("temp dir should be removed");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "system-prompt-hierarchy");
    let prompt = value["result"]["prompt"]
        .as_str()
        .expect("prompt should be a string");
    assert!(prompt.contains(r#"{"entry":"src","isDirectory":true}"#));
    assert!(prompt.contains(r#"{"entry":"src/main.rs","isDirectory":false}"#));
    assert!(prompt.contains(r#"{"entry":"src/nested","isDirectory":true}"#));
    assert!(prompt.contains(r#"{"entry":"src/nested/mod.rs","isDirectory":false}"#));
    assert!(!prompt.contains(r#"{"entry":"target","isDirectory":true}"#));
    assert!(!prompt.contains("target/debug/artifact"));
    assert!(!prompt.contains("debug.log"));
}

#[test]
fn notifications_do_not_emit_responses() {
    let line = json!({
        "jsonrpc": "2.0",
        "method": AGENTD_INITIALIZE_METHOD
    })
    .to_string();

    assert_eq!(handle_agentd_json_rpc_line(&line), None);
}

#[test]
fn malformed_json_returns_parse_error() {
    let response = handle_agentd_json_rpc_line("{").expect("parse error should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], serde_json::Value::Null);
    assert_eq!(value["error"]["code"], -32700);
    assert_eq!(value["error"]["message"], "Parse error");
}

#[test]
fn unknown_method_returns_method_not_found() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "octofriend.agentd/missing"
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], 9);
    assert_eq!(value["error"]["code"], -32601);
    assert_eq!(value["error"]["message"], "Method not found");
}
