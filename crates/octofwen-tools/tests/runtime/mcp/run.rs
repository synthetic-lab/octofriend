#[cfg(not(windows))]
use octofwen_tools::runtime::run_runtime_tool_call;
#[cfg(not(windows))]
use serde_json::json;

#[cfg(not(windows))]
#[test]
fn runs_runtime_mcp_tool_calls_through_stdio_server() {
    let root = unique_temp_dir("octofwen-tools-mcp-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    let server_path = root.join("fake-mcp-server.sh");
    std::fs::write(
        &server_path,
        r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1.0.0"}}}'
      ;;
    *'"method":"notifications/initialized"'*)
      ;;
    *'"method":"tools/list"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"read_file","description":"Read a file"}]}}'
      ;;
    *'"method":"tools/call"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"from fake mcp"}]}}'
      ;;
  esac
done
"#,
    )
    .expect("server script should be written");

    let output = run_runtime_tool_call(
        "mcp",
        &root,
        "mcp-1",
        &json!({ "type": "tool-call", "toolCallId": "mcp-1", "name": "mcp", "original": { "server": "filesystem", "tool": "read_file", "arguments": { "path": "README.md" } }, "parsed": { "server": "filesystem", "tool": "read_file", "arguments": { "path": "README.md" } } }),
        &json!({
            "server": "filesystem",
            "tool": "read_file",
            "arguments": { "path": "README.md" },
            "serverCommand": "/bin/sh",
            "serverArgs": [server_path],
            "serverEnv": {},
            "modelContext": 100
        }),
    )
    .expect("mcp should run through the runtime");

    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": "from fake mcp" }],
            "lines": null
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
#[test]
fn resolves_runtime_mcp_server_from_config_through_agentd() {
    let root = unique_temp_dir("octofwen-tools-mcp-config-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    let server_path = root.join("fake-mcp-server.sh");
    std::fs::write(
        &server_path,
        r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1.0.0"}}}'
      ;;
    *'"method":"notifications/initialized"'*)
      ;;
    *'"method":"tools/list"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"read_file","description":"Read a file"}]}}'
      ;;
    *'"method":"tools/call"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"from configured fake mcp"}]}}'
      ;;
  esac
done
"#,
    )
    .expect("server script should be written");

    let output = run_runtime_tool_call(
        "mcp",
        &root,
        "mcp-1",
        &json!({ "type": "tool-call", "toolCallId": "mcp-1", "name": "mcp", "original": { "server": "filesystem", "tool": "read_file", "arguments": { "path": "README.md" } }, "parsed": { "server": "filesystem", "tool": "read_file", "arguments": { "path": "README.md" } } }),
        &json!({
            "server": "filesystem",
            "tool": "read_file",
            "arguments": { "path": "README.md" },
            "mcpServers": {
                "filesystem": {
                    "command": "/bin/sh",
                    "args": [server_path],
                    "env": { "TOKEN": "abc" }
                }
            },
            "modelContext": 100
        }),
    )
    .expect("mcp server config should be resolved through agentd");

    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": "from configured fake mcp" }],
            "lines": null
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}
