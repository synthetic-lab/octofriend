use octofwen_tools::runtime::run_runtime_tool_call;
use serde_json::json;

#[test]
fn runs_runtime_lsp_definition_tool_calls_through_stdio_server() {
    let root = unique_temp_dir("octofwen-tools-lsp-run");
    std::fs::create_dir_all(root.join("src")).expect("fixture dirs should be created");
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

    let output = run_runtime_tool_call(
        "lsp-definition",
        &root,
        "lsp-1",
        &json!({ "type": "tool-call", "toolCallId": "lsp-1", "name": "lsp-definition", "original": { "filePath": "src/main.ts", "line": 7, "character": 3 }, "parsed": { "filePath": "src/main.ts", "line": 7, "character": 3 } }),
        &json!({
            "filePath": "src/main.ts",
            "resolvedFilePath": root.join("src/main.ts"),
            "line": 7,
            "character": 3,
            "serverCommand": "python3",
            "serverArgs": [server_path],
            "rootPath": root,
            "fileContent": "const value = 1;\n"
        }),
    )
    .expect("lsp should run through the runtime");

    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": format!("Definition results for {}:7:3:\n/repo/src/target.ts:5:8", root.join("src/main.ts").display()) }],
            "lines": null
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn detects_lsp_server_from_runtime_config_and_reads_file_through_agentd() {
    let root = unique_temp_dir("octofwen-tools-lsp-detect-run");
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

    let output = run_runtime_tool_call(
        "lsp-definition",
        &root,
        "lsp-1",
        &json!({ "type": "tool-call", "toolCallId": "lsp-1", "name": "lsp-definition", "original": { "filePath": "src/main.ts", "line": 7, "character": 3 }, "parsed": { "filePath": "src/main.ts", "line": 7, "character": 3 } }),
        &json!({
            "filePath": "src/main.ts",
            "line": 7,
            "character": 3,
            "lsp": {
                "fixture-lsp": {
                    "command": ["python3", server_path],
                    "extensions": [".ts"],
                    "rootCandidates": ["package.json"]
                }
            }
        }),
    )
    .expect("lsp should be detected and run through the runtime");

    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": format!("Definition results for {}:7:3:\n/repo/src/target.ts:5:8", std::fs::canonicalize(root.join("src/main.ts")).expect("fixture path should canonicalize").display()) }],
            "lines": null
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}
