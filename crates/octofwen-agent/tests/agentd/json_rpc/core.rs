use octofwen_agent::agentd::{
    AGENTD_INITIALIZE_METHOD, AGENTD_SYSTEM_PROMPT_METHOD, handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

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
    assert_eq!(value["result"]["serverInfo"]["name"], "octofwen-agentd");
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
    let original_dir = std::env::current_dir().expect("current dir should be available");
    let temp_dir = std::env::temp_dir().join(format!(
        "octofwen-agent-system-prompt-{}-{}",
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

    std::env::set_current_dir(&temp_dir).expect("temp dir should become cwd");
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
    std::env::set_current_dir(original_dir).expect("original cwd should be restored");
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
        "method": "octofwen.agentd/missing"
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], 9);
    assert_eq!(value["error"]["code"], -32601);
    assert_eq!(value["error"]["message"], "Method not found");
}
