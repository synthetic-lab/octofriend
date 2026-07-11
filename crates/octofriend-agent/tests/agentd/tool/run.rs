use octofriend_agent::runtime::{AGENTD_TOOL_RUN_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn tool_run_request_returns_tool_run_result() {
    let root = unique_temp_dir("octofriend-agentd-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    std::fs::write(root.join("read.txt"), "alpha\nbeta").expect("fixture file should be written");

    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-read",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "read",
            "cwd": root,
            "toolCallId": "read-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "read-1",
                "name": "read",
                "original": { "filePath": "read.txt" },
                "parsed": { "filePath": "read.txt" }
            },
            "parsed": { "filePath": "read.txt" }
        }
    })
    .to_string();

    let response = run_agentd_with_path(&line, &root);
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "custom-ir",
                "data": {
                    "role": "file-read",
                    "content": "1: alpha\n2: beta",
                    "toolCall": {
                        "type": "tool-call",
                        "toolCallId": "read-1",
                        "name": "read",
                        "original": { "filePath": "read.txt" },
                        "parsed": { "filePath": "read.txt" }
                    },
                    "path": "read.txt"
                }
            }
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
#[test]
fn tool_run_request_runs_shell_in_docker_transport() {
    let root = unique_temp_dir("octofriend-agentd-docker-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    let fake_docker = root.join("docker");
    let docker_log = root.join("docker.log");
    std::fs::write(
        &fake_docker,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nprintf 'docker-output\\n'\n",
            docker_log.display()
        ),
    )
    .expect("fake docker should be written");
    make_executable(&fake_docker);
    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-docker-shell",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "shell",
            "cwd": root,
            "transport": { "type": "docker", "container": "octofriend-test-container" },
            "toolCallId": "shell-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "shell-1",
                "name": "shell",
                "original": { "cmd": "cat marker.txt", "timeout": 5000 },
                "parsed": { "cmd": "cat marker.txt", "timeout": 5000 }
            },
            "parsed": { "cmd": "cat marker.txt", "timeout": 5000 }
        }
    })
    .to_string();

    let response = run_agentd_with_path(&line, &root);
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "output",
                "content": [{ "type": "text", "content": "docker-output\n" }],
                "lines": null
            }
        })
    );
    let logged = std::fs::read_to_string(&docker_log).expect("fake docker should be invoked");
    assert!(logged.contains("exec"));
    assert!(logged.contains("octofriend-test-container"));

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
#[test]
fn tool_run_request_runs_shell_in_ssh_transport() {
    let root = unique_temp_dir("octofriend-agentd-ssh-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    let fake_ssh = root.join("ssh");
    let ssh_log = root.join("ssh.log");
    let remote_cwd = root.join("remote/workspace");
    std::fs::create_dir_all(&remote_cwd).expect("remote cwd should be created");
    std::fs::write(remote_cwd.join("marker.txt"), "ssh-output")
        .expect("remote marker should be written");
    std::fs::write(
        &fake_ssh,
        format!(
            "#!/bin/sh\nprintf 'target=%s command=%s\\n' \"$1\" \"$2\" > '{}'\nshift\n/bin/sh -c \"$1\"\n",
            ssh_log.display()
        ),
    )
    .expect("fake ssh should be written");
    make_executable(&fake_ssh);
    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-ssh-shell",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "shell",
            "cwd": remote_cwd,
            "transport": { "type": "ssh", "target": "user@example.test" },
            "toolCallId": "shell-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "shell-1",
                "name": "shell",
                "original": { "cmd": "cat marker.txt", "timeout": 5000 },
                "parsed": { "cmd": "cat marker.txt", "timeout": 5000 }
            },
            "parsed": { "cmd": "cat marker.txt", "timeout": 5000 }
        }
    })
    .to_string();

    let response = run_agentd_with_path(&line, &root);
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "output",
                "content": [{ "type": "text", "content": "ssh-output" }],
                "lines": null
            }
        })
    );
    let logged = std::fs::read_to_string(&ssh_log).expect("fake ssh should be invoked");
    assert!(logged.contains("user@example.test"));
    assert!(logged.contains("cat marker.txt"));

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
#[test]
fn tool_run_request_reads_files_in_docker_transport() {
    let root = unique_temp_dir("octofriend-agentd-docker-read");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    std::fs::write(
        root.join("read.txt"),
        "host
",
    )
    .expect("host fixture should be written");
    let fake_docker = root.join("docker");
    std::fs::write(
        &fake_docker,
        "#!/bin/sh
printf 'remote'
",
    )
    .expect("fake docker should be written");
    make_executable(&fake_docker);
    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-docker-read",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "read",
            "cwd": root,
            "transport": { "type": "docker", "container": "octofriend-test-container" },
            "toolCallId": "read-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "read-1",
                "name": "read",
                "original": { "filePath": "read.txt" },
                "parsed": { "filePath": "read.txt" }
            },
            "parsed": { "filePath": "read.txt" }
        }
    })
    .to_string();

    let response = run_agentd_with_path(&line, &root);
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "custom-ir",
                "data": {
                    "role": "file-read",
                    "content": "1: remote",
                    "toolCall": {
                        "type": "tool-call",
                        "toolCallId": "read-1",
                        "name": "read",
                        "original": { "filePath": "read.txt" },
                        "parsed": { "filePath": "read.txt" }
                    },
                    "path": "read.txt"
                }
            }
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
#[test]
fn tool_run_request_runs_search_tools_in_docker_transport() {
    let root = unique_temp_dir("octofriend-agentd-docker-search");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    let fake_docker = root.join("docker");
    std::fs::write(
        &fake_docker,
        r#"#!/bin/sh
case "$*" in
  *grep*) printf './remote.ts:1:needle
' ;;
  *find*) printf './remote.ts
./nested/child.ts
' ;;
  *) printf '' ;;
esac
"#,
    )
    .expect("fake docker should be written");
    make_executable(&fake_docker);

    let grep = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-docker-grep",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "grep",
            "cwd": root,
            "transport": { "type": "docker", "container": "octofriend-test-container" },
            "toolCallId": "grep-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "grep-1",
                "name": "grep",
                "original": { "pattern": "needle", "timeout": 5000 },
                "parsed": { "pattern": "needle", "timeout": 5000 }
            },
            "parsed": { "pattern": "needle", "timeout": 5000 }
        }
    })
    .to_string();
    let grep_response = run_agentd_with_path(&grep, &root);
    let grep_value: serde_json::Value =
        serde_json::from_str(&grep_response).expect("grep response should be json");
    assert_eq!(
        grep_value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "output",
                "content": [{ "type": "text", "content": "./remote.ts:1:needle" }],
                "lines": null
            }
        })
    );

    let glob = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-docker-glob",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "glob",
            "cwd": root,
            "transport": { "type": "docker", "container": "octofriend-test-container" },
            "toolCallId": "glob-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "glob-1",
                "name": "glob",
                "original": { "includeName": "*.ts" },
                "parsed": { "includeName": "*.ts" }
            },
            "parsed": { "includeName": "*.ts" }
        }
    })
    .to_string();
    let glob_response = run_agentd_with_path(&glob, &root);
    let glob_value: serde_json::Value =
        serde_json::from_str(&glob_response).expect("glob response should be json");
    assert_eq!(
        glob_value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "output",
                "content": [{ "type": "text", "content": "remote.ts\nnested/child.ts" }],
                "lines": null
            }
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
#[test]
fn tool_run_request_returns_mcp_tool_result() {
    let root = unique_temp_dir("octofriend-agentd-mcp-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    let server_path = root.join("fake-mcp-server.sh");
    std::fs::write(
        &server_path,
        r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s
' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1.0.0"}}}'
      ;;
    *'"method":"notifications/initialized"'*)
      ;;
    *'"method":"tools/list"'*)
      printf '%s
' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"read_file","description":"Read a file"}]}}'
      ;;
    *'"method":"tools/call"'*)
      printf '%s
' '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"from fake mcp"}]}}'
      ;;
  esac
done
"#,
    )
    .expect("server script should be written");

    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-mcp",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "mcp",
            "cwd": root,
            "toolCallId": "mcp-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "mcp-1",
                "name": "mcp",
                "original": {
                    "server": "filesystem",
                    "tool": "read_file",
                    "arguments": { "path": "README.md" }
                },
                "parsed": {
                    "server": "filesystem",
                    "tool": "read_file",
                    "arguments": { "path": "README.md" }
                }
            },
            "parsed": {
                "server": "filesystem",
                "tool": "read_file",
                "arguments": { "path": "README.md" }
            },
            "modelContext": 100,
            "mcpServers": {
                "filesystem": {
                    "command": "/bin/sh",
                    "args": [server_path],
                    "env": {}
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "output",
                "content": [{ "type": "text", "content": "from fake mcp" }],
                "lines": null
            }
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[cfg(not(windows))]
#[test]
fn tool_run_request_inserts_lsp_config_before_tool_run() {
    let root = unique_temp_dir("octofriend-agentd-lsp-run");
    std::fs::create_dir_all(root.join("src")).expect("fixture dirs should be created");
    std::fs::write(root.join("package.json"), "{}\n").expect("root marker should be written");
    std::fs::write(root.join("src/main.ts"), "const value = 1;\n")
        .expect("fixture file should be written");
    let server_path = root.join("fake_lsp_server.py");
    std::fs::write(
        &server_path,
        r#"import json
import sys

def read_message():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        key, value = line.decode("utf-8").split(":", 1)
        headers[key.lower()] = value.strip()
    length = int(headers["content-length"])
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))

def send(message):
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body)
    sys.stdout.buffer.flush()

while True:
    message = read_message()
    if message is None:
        break
    method = message.get("method")
    if "id" not in message:
        continue
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"capabilities": {}}})
    elif method == "textDocument/definition":
        send({"jsonrpc": "2.0", "id": message["id"], "result": [{"uri": "file:///repo/src/target.ts", "range": {"start": {"line": 4, "character": 7}, "end": {"line": 4, "character": 12}}}]})
    else:
        send({"jsonrpc": "2.0", "id": message["id"], "result": None})
"#,
    )
    .expect("server script should be written");

    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-lsp",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "lsp-definition",
            "cwd": root,
            "toolCallId": "lsp-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "lsp-1",
                "name": "lsp-definition",
                "original": {
                    "filePath": "src/main.ts",
                    "line": 7,
                    "character": 3
                },
                "parsed": {
                    "filePath": "src/main.ts",
                    "line": 7,
                    "character": 3
                }
            },
            "parsed": {
                "filePath": "src/main.ts",
                "line": 7,
                "character": 3
            },
            "lsp": {
                "fixture-lsp": {
                    "command": ["python3", server_path],
                    "extensions": [".ts"],
                    "rootCandidates": ["package.json"]
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    let canonical_file =
        std::fs::canonicalize(root.join("src/main.ts")).expect("fixture file should canonicalize");

    assert_eq!(
        value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "output",
                "content": [{
                    "type": "text",
                    "content": format!(
                        "Definition results for {}:7:3:\n/repo/src/target.ts:5:8",
                        canonical_file.display()
                    )
                }],
                "lines": null
            }
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn tool_run_request_inserts_skill_context_before_tool_run() {
    let root = unique_temp_dir("octofriend-agentd-skill-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-skill",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "skill",
            "cwd": root,
            "toolCallId": "skill-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "skill-1",
                "name": "skill",
                "original": { "skillName": "review-code" },
                "parsed": { "skillName": "review-code" }
            },
            "parsed": { "skillName": "review-code" },
            "userName": "Octo",
            "skills": [{
                "name": "review-code",
                "description": "Reviews source changes.",
                "instructions": "Inspect the diff before commenting.",
                "path": "/home/user/.config/agents/skills/review-code",
                "skillFilePath": "/home/user/.config/agents/skills/review-code/SKILL.md"
            }]
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    let content = value["result"]["result"]["content"][0]["content"]
        .as_str()
        .expect("skill output content should be text");

    assert_eq!(value["result"]["status"], json!("completed"));
    assert!(content.contains("Skill name: review-code"));
    assert!(content.contains("Octo has set up a skill for you to use."));
    assert!(content.contains("Inspect the diff before commenting."));

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn tool_run_request_inserts_web_search_config_before_tool_run() {
    let server = TestHttpServer::start(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: 89\r\n\r\n{\"results\":[{\"url\":\"https://example.com/a\",\"title\":\"A\",\"text\":\"Alpha\",\"published\":null}]}",
    );
    let root = unique_temp_dir("octofriend-agentd-web-search-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-run-web-search",
        "method": AGENTD_TOOL_RUN_METHOD,
        "params": {
            "toolName": "web-search",
            "cwd": root,
            "toolCallId": "search-1",
            "toolCall": {
                "type": "tool-call",
                "toolCallId": "search-1",
                "name": "web-search",
                "original": { "query": "octofriend" },
                "parsed": { "query": "octofriend" }
            },
            "parsed": { "query": "octofriend" },
            "webSearch": {
                "searchUrl": server.url(),
                "searchKey": "search-key"
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "status": "completed",
            "result": {
                "type": "output",
                "content": [{ "type": "text", "content": "{\"url\":\"https://example.com/a\",\"title\":\"A\",\"text\":\"Alpha\",\"published\":null}" }],
                "lines": null
            }
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

struct TestHttpServer {
    address: std::net::SocketAddr,
}

impl TestHttpServer {
    fn start(response: &'static str) -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .expect("test server should bind to a local port");
        let address = listener
            .local_addr()
            .expect("test server local address should be available");
        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("test server should accept one request");
            let mut request = [0_u8; 1024];
            let _ = std::io::Read::read(&mut stream, &mut request);
            std::io::Write::write_all(&mut stream, response.as_bytes())
                .expect("test server response should be written");
        });
        Self { address }
    }

    fn url(&self) -> String {
        format!("http://{}", self.address)
    }
}

fn run_agentd_with_path(line: &str, path_dir: &std::path::Path) -> String {
    let binary = env!("CARGO_BIN_EXE_octofriend-agentd");
    let mut child = std::process::Command::new(binary)
        .env(
            "PATH",
            std::env::join_paths(std::iter::once(path_dir.to_path_buf()).chain(
                std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()),
            ))
            .expect("PATH should join"),
        )
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("agentd should spawn");
    {
        use std::io::Write;
        let stdin = child.stdin.as_mut().expect("agentd stdin should be piped");
        writeln!(stdin, "{line}").expect("request should be written");
    }
    drop(child.stdin.take());
    let output = child
        .wait_with_output()
        .expect("agentd output should be collected");
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .expect("agentd stdout should be utf-8")
        .trim_end()
        .to_string()
}

#[cfg(not(windows))]
fn make_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .expect("executable metadata should be readable")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).expect("executable permissions should be set");
    }
}

fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}
