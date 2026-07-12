use octofriend_tools::runtime::{
    TOOL_BUILDER, ToolBuilder, ToolRegistry, ToolReturn, custom_ir, flatten_tool_call,
    parse_tool_arguments, run_runtime_tool_call, validate_runtime_tool_call,
    validate_tool_arguments,
};
use serde_json::json;

#[cfg(windows)]
fn successful_shell_command() -> &'static str {
    "set /p octofriend_TEST=hello<NUL & exit /b 0"
}

#[cfg(not(windows))]
fn successful_shell_command() -> &'static str {
    "printf hello"
}

#[cfg(windows)]
fn failing_shell_command() -> &'static str {
    "set /p octofriend_TEST=nope<NUL & exit /b 7"
}

#[cfg(not(windows))]
fn failing_shell_command() -> &'static str {
    "printf nope; exit 7"
}

#[cfg(windows)]
fn successful_shell_output() -> &'static str {
    "hello "
}

#[cfg(not(windows))]
fn successful_shell_output() -> &'static str {
    "hello"
}

#[cfg(windows)]
fn failing_shell_error() -> String {
    "Command exited with code: 7\noutput: nope ".into()
}

#[cfg(not(windows))]
fn failing_shell_error() -> String {
    "Command exited with code: 7\noutput: nope".into()
}

fn normalize_shell_text(text: &str) -> String {
    text.replace("\r\n", "\n")
}

#[test]
fn tool_builder_declares_auto_parsed_tools_with_default_parse_and_validate_behavior() {
    let tool = ToolBuilder
        .declare(
            "echo",
            "Echo a message",
            json!({
                "type": "object",
                "required": ["message"],
                "properties": { "message": { "type": "string" } }
            }),
        )
        .define();

    assert_eq!(tool.definition.name, "echo");
    assert_eq!(tool.definition.description, "Echo a message");
    assert_eq!(
        tool.definition.parsed_schema,
        tool.definition.arguments_schema
    );

    let parsed = tool.parse(json!({ "message": "hi" }));
    assert_eq!(parsed.original, json!({ "message": "hi" }));
    assert_eq!(parsed.parsed, json!({ "message": "hi" }));

    let call = flatten_tool_call(
        "call-1",
        "echo",
        json!({ "message": "hi" }),
        json!({ "message": "hi" }),
    );
    assert_eq!(tool.validate(&call), Ok(()));
    assert_eq!(
        validate_tool_arguments(&tool.definition, &call.parsed),
        Ok(())
    );
}

#[test]
fn tool_builder_supports_explicit_parsed_schema_and_custom_ir_values() {
    let tool = ToolBuilder
        .declare(
            "write",
            "Write content",
            json!({
                "type": "object",
                "required": ["filePath", "content"],
                "properties": {
                    "filePath": { "type": "string" },
                    "content": { "type": "string" }
                }
            }),
        )
        .with_parsed_schema(json!({
            "type": "object",
            "required": ["filePath", "content", "normalized"],
            "properties": {
                "filePath": { "type": "string" },
                "content": { "type": "string" },
                "normalized": { "type": "boolean" }
            }
        }))
        .define();

    assert_ne!(
        tool.definition.parsed_schema,
        tool.definition.arguments_schema
    );
    let ir = custom_ir(json!({ "type": "file-write", "path": "a.txt", "content": "new content" }));
    assert_eq!(
        ir,
        ToolReturn::CustomIr {
            data: json!({ "type": "file-write", "path": "a.txt", "content": "new content" })
        }
    );
}

#[test]
fn dynamic_define_tool_selects_a_runtime_tool_and_preserves_null_selection() {
    let selected = ToolBuilder.dynamic_define_tool(|| {
        Some(
            ToolBuilder
                .declare(
                    "selected",
                    "Selected dynamically",
                    json!({ "type": "object", "required": ["value"] }),
                )
                .define(),
        )
    });
    let disabled = ToolBuilder.dynamic_define_tool(|| None);

    assert_eq!(
        selected.as_ref().map(|tool| tool.definition.name.as_str()),
        Some("selected")
    );
    assert!(disabled.is_none());
}

#[test]
fn tool_registry_validates_known_unknown_and_incomplete_tool_calls() {
    let tool = ToolBuilder
        .declare(
            "echo",
            "Echo",
            json!({ "type": "object", "required": ["message"] }),
        )
        .define();
    let mut registry = ToolRegistry::new();
    registry.insert(tool);

    assert_eq!(registry.names(), ["echo"]);
    assert_eq!(
        registry.validate_call(&flatten_tool_call(
            "call-1",
            "echo",
            json!({ "message": "hi" }),
            json!({ "message": "hi" }),
        )),
        Ok(())
    );
    assert_eq!(
        registry.validate_call(&flatten_tool_call(
            "call-2",
            "missing",
            json!({}),
            json!({})
        )),
        Err("unknown tool missing".into())
    );
    assert_eq!(
        registry.validate_call(&flatten_tool_call("call-3", "echo", json!({}), json!({}))),
        Err("missing required tool argument message".into())
    );
}

#[test]
fn tool_builder_exposes_a_shared_builder_instance() {
    assert_eq!(
        TOOL_BUILDER.with_data::<()>().with_transport::<()>(),
        ToolBuilder
    );
}

#[test]
fn validates_json_schema_property_types() {
    let tool = ToolBuilder
        .declare(
            "search",
            "Search",
            json!({
                "type": "object",
                "required": ["query", "limit"],
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "number" },
                    "exact": { "type": "boolean" }
                }
            }),
        )
        .define();

    assert_eq!(
        validate_tool_arguments(
            &tool.definition,
            &json!({ "query": "needle", "limit": 2, "exact": false })
        ),
        Ok(())
    );
    assert_eq!(
        validate_tool_arguments(&tool.definition, &json!({ "query": 12, "limit": 2 })),
        Err("tool argument query must be a string".into())
    );
    assert_eq!(
        validate_tool_arguments(
            &tool.definition,
            &json!({ "query": "needle", "limit": "2" })
        ),
        Err("tool argument limit must be a number".into())
    );
    assert_eq!(
        validate_tool_arguments(
            &tool.definition,
            &json!({ "query": "needle", "limit": 2, "exact": "yes" })
        ),
        Err("tool argument exact must be a boolean".into())
    );
}

#[test]
fn validates_nested_json_schema_with_schema_crate_semantics() {
    let tool = ToolBuilder
        .declare(
            "write_plan",
            "Write a plan",
            json!({
                "type": "object",
                "required": ["plan"],
                "properties": {
                    "plan": {
                        "type": "object",
                        "required": ["steps"],
                        "properties": {
                            "steps": {
                                "type": "array",
                                "minItems": 1,
                                "items": {
                                    "type": "object",
                                    "required": ["title"],
                                    "properties": {
                                        "title": { "type": "string" }
                                    }
                                }
                            }
                        }
                    }
                }
            }),
        )
        .define();

    assert_eq!(
        validate_tool_arguments(
            &tool.definition,
            &json!({ "plan": { "steps": [{ "title": "inspect" }] } })
        ),
        Ok(())
    );
    assert_eq!(
        validate_tool_arguments(&tool.definition, &json!({ "plan": { "steps": [] } })),
        Err("tool argument validation failed at /plan/steps: [] has less than 1 item".into())
    );
    assert_eq!(
        validate_tool_arguments(&tool.definition, &json!({ "plan": { "steps": [{}] } })),
        Err(
            "tool argument validation failed at /plan/steps/0: \"title\" is a required property"
                .into()
        )
    );
}

#[test]
fn parses_file_mutation_arguments_without_original_file_contents_at_parse_time() {
    let root = unique_temp_dir("octofriend-tools-parse");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    let file_path = root.join("edit.txt");
    std::fs::write(&file_path, "before\nold\nafter").expect("fixture file should be written");

    let parsed = parse_tool_arguments(
        "edit",
        &root,
        json!({ "filePath": "edit.txt", "search": "old", "replace": "new" }),
    )
    .expect("edit arguments should parse");

    assert_eq!(
        parsed.original,
        json!({ "filePath": "edit.txt", "search": "old", "replace": "new" })
    );
    assert_eq!(
        parsed.parsed,
        json!({ "filePath": "edit.txt", "search": "old", "replace": "new" })
    );
    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn parses_file_mutation_arguments_without_original_file_contents_when_file_is_missing() {
    let root = unique_temp_dir("octofriend-tools-parse-missing");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let parsed = parse_tool_arguments(
        "edit",
        &root,
        json!({ "filePath": "missing.txt", "search": "old", "replace": "new" }),
    )
    .expect("edit arguments should parse even when target file is missing");

    assert_eq!(
        parsed.original,
        json!({ "filePath": "missing.txt", "search": "old", "replace": "new" })
    );
    assert_eq!(
        parsed.parsed,
        json!({ "filePath": "missing.txt", "search": "old", "replace": "new" })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn parses_file_mutation_arguments_drops_stale_original_file_contents_when_file_is_missing() {
    let root = unique_temp_dir("octofriend-tools-parse-stale");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let parsed = parse_tool_arguments(
        "rewrite",
        &root,
        json!({
            "filePath": "missing.txt",
            "text": "replacement",
            "originalFileContents": "model-supplied stale contents"
        }),
    )
    .expect("rewrite arguments should parse even when target file is missing");

    assert_eq!(
        parsed.original,
        json!({ "filePath": "missing.txt", "text": "replacement" })
    );
    assert_eq!(
        parsed.parsed,
        json!({ "filePath": "missing.txt", "text": "replacement" })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn auto_parses_non_file_mutation_arguments_as_identity() {
    let parsed = parse_tool_arguments("read", ".", json!({ "filePath": "notes.txt" }))
        .expect("read arguments should parse");

    assert_eq!(parsed.original, json!({ "filePath": "notes.txt" }));
    assert_eq!(parsed.parsed, json!({ "filePath": "notes.txt" }));
}

fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}

#[test]
fn validates_runtime_file_and_workspace_tool_calls() {
    let root = unique_temp_dir("octofriend-tools-validate");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    std::fs::create_dir_all(root.join("src")).expect("src dir should be created");
    std::fs::write(root.join("edit.txt"), "before old after")
        .expect("edit fixture should be written");
    std::fs::write(root.join("exists.txt"), "already here")
        .expect("create fixture should be written");

    assert_eq!(
        validate_runtime_tool_call("list", &root, &json!({ "dirPath": "src" })),
        Ok(())
    );
    assert_eq!(
        validate_runtime_tool_call("list", &root, &json!({ "dirPath": "missing" })),
        Err("missing is not a directory".into())
    );
    assert_eq!(
        validate_runtime_tool_call("create", &root, &json!({ "filePath": "new.txt" })),
        Ok(())
    );
    assert_eq!(
        validate_runtime_tool_call("create", &root, &json!({ "filePath": "exists.txt" })),
        Err("File already exists".into())
    );
    assert_eq!(
        validate_runtime_tool_call("read", &root, &json!({ "filePath": "edit.txt" })),
        Ok(())
    );
    assert_eq!(
        validate_runtime_tool_call("read", &root, &json!({ "filePath": "missing.txt" })),
        Err("missing.txt couldn't be read".into())
    );
    assert_eq!(
        validate_runtime_tool_call("rewrite", &root, &json!({ "filePath": "edit.txt" })),
        Ok(())
    );
    assert_eq!(
        validate_runtime_tool_call(
            "edit",
            &root,
            &json!({ "filePath": "edit.txt", "search": "old" })
        ),
        Ok(())
    );
    assert_eq!(
        validate_runtime_tool_call(
            "edit",
            &root,
            &json!({ "filePath": "edit.txt", "search": "absent" })
        ),
        Err("Could not find search string in file edit.txt: absent
This is likely an error in your formatting. The search string must EXACTLY match, including
whitespace and punctuation."
            .into())
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn runs_runtime_file_and_workspace_tool_calls() {
    let root = unique_temp_dir("octofriend-tools-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    std::fs::create_dir_all(root.join("src")).expect("src dir should be created");
    std::fs::write(root.join("read.txt"), "alpha\nbeta\ngamma")
        .expect("read fixture should be written");
    std::fs::write(root.join("edit.txt"), "before old after")
        .expect("edit fixture should be written");
    std::fs::write(root.join("rewrite.txt"), "old file")
        .expect("rewrite fixture should be written");

    let list = run_runtime_tool_call(
        "list",
        &root,
        "list-1",
        &json!({ "type": "tool-call", "toolCallId": "list-1", "name": "list", "original": { "dirPath": "." }, "parsed": { "dirPath": "." } }),
        &json!({ "dirPath": "." }),
    )
    .expect("list should run");
    assert_eq!(list["type"], json!("output"));
    assert!(
        list["content"][0]["content"]
            .as_str()
            .unwrap()
            .contains("read.txt")
    );

    let full_read = run_runtime_tool_call(
        "read",
        &root,
        "read-1",
        &json!({ "type": "tool-call", "toolCallId": "read-1", "name": "read", "original": { "filePath": "read.txt" }, "parsed": { "filePath": "read.txt" } }),
        &json!({ "filePath": "read.txt" }),
    )
    .expect("read should run");
    assert_eq!(
        full_read,
        json!({
            "type": "custom-ir",
            "data": {
                "role": "file-read",
                "content": "1: alpha\n2: beta\n3: gamma",
                "toolCall": { "type": "tool-call", "toolCallId": "read-1", "name": "read", "original": { "filePath": "read.txt" }, "parsed": { "filePath": "read.txt" } },
                "path": "read.txt"
            }
        })
    );

    let partial_read = run_runtime_tool_call(
        "read",
        &root,
        "read-2",
        &json!({ "type": "tool-call", "toolCallId": "read-2", "name": "read", "original": { "filePath": "read.txt", "offset": 2, "limit": 1 }, "parsed": { "filePath": "read.txt", "offset": 2, "limit": 1 } }),
        &json!({ "filePath": "read.txt", "offset": 2, "limit": 1 }),
    )
    .expect("partial read should run");
    assert_eq!(
        partial_read,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": "Showing lines 2-2 of 3 from read.txt\n2: beta" }],
            "lines": 3
        })
    );

    let create = run_runtime_tool_call(
        "create",
        &root,
        "create-1",
        &json!({ "type": "tool-call", "toolCallId": "create-1", "name": "create", "original": { "filePath": "new.txt", "content": "new file" }, "parsed": { "filePath": "new.txt", "content": "new file" } }),
        &json!({ "filePath": "new.txt", "content": "new file" }),
    )
    .expect("create should run");
    assert_eq!(
        std::fs::read_to_string(root.join("new.txt")).unwrap(),
        "new file"
    );
    assert_eq!(create["data"]["role"], json!("file-mutate"));

    let edit = run_runtime_tool_call(
        "edit",
        &root,
        "edit-1",
        &json!({ "type": "tool-call", "toolCallId": "edit-1", "name": "edit", "original": { "filePath": "edit.txt", "search": "old", "replace": "new" }, "parsed": { "filePath": "edit.txt", "search": "old", "replace": "new" } }),
        &json!({ "filePath": "edit.txt", "search": "old", "replace": "new" }),
    )
    .expect("edit should run");
    assert_eq!(
        std::fs::read_to_string(root.join("edit.txt")).unwrap(),
        "before new after"
    );
    assert_eq!(edit["data"]["role"], json!("file-mutate"));

    let rewrite = run_runtime_tool_call(
        "rewrite",
        &root,
        "rewrite-1",
        &json!({ "type": "tool-call", "toolCallId": "rewrite-1", "name": "rewrite", "original": { "filePath": "rewrite.txt", "text": "rewritten" }, "parsed": { "filePath": "rewrite.txt", "text": "rewritten" } }),
        &json!({ "filePath": "rewrite.txt", "text": "rewritten" }),
    )
    .expect("rewrite should run");
    assert_eq!(
        std::fs::read_to_string(root.join("rewrite.txt")).unwrap(),
        "rewritten"
    );
    assert_eq!(rewrite["data"]["role"], json!("file-mutate"));

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn runs_runtime_shell_tool_calls() {
    let root = unique_temp_dir("octofriend-tools-shell-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let output = run_runtime_tool_call(
        "shell",
        &root,
        "shell-1",
        &json!({ "type": "tool-call", "toolCallId": "shell-1", "name": "shell", "original": { "cmd": successful_shell_command(), "timeout": 1000 }, "parsed": { "cmd": successful_shell_command(), "timeout": 1000 } }),
        &json!({ "cmd": successful_shell_command(), "timeout": 1000 }),
    )
    .expect("shell should run");
    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": successful_shell_output() }],
            "lines": null
        })
    );

    let failed = run_runtime_tool_call(
        "shell",
        &root,
        "shell-2",
        &json!({ "type": "tool-call", "toolCallId": "shell-2", "name": "shell", "original": { "cmd": failing_shell_command(), "timeout": 1000 }, "parsed": { "cmd": failing_shell_command(), "timeout": 1000 } }),
        &json!({ "cmd": failing_shell_command(), "timeout": 1000 }),
    );
    assert_eq!(
        failed.map_err(|error| normalize_shell_text(&error)),
        Err(failing_shell_error())
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn runs_runtime_skill_tool_calls() {
    let root = unique_temp_dir("octofriend-tools-skill-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let output = run_runtime_tool_call(
        "skill",
        &root,
        "skill-1",
        &json!({ "type": "tool-call", "toolCallId": "skill-1", "name": "skill", "original": { "skillName": "review-code" }, "parsed": { "skillName": "review-code" } }),
        &json!({
            "skillName": "review-code",
            "userName": "Octo",
            "skills": [{
                "name": "review-code",
                "description": "Reviews source changes.",
                "instructions": "Inspect the diff before commenting.",
                "path": "/home/user/.config/agents/skills/review-code",
                "skillFilePath": "/home/user/.config/agents/skills/review-code/SKILL.md"
            }]
        }),
    )
    .expect("skill should run");

    assert_eq!(output["type"], json!("output"));
    let content = output["content"][0]["content"].as_str().unwrap();
    assert!(content.contains("Skill name: review-code"));
    assert!(content.contains("Octo has set up a skill for you to use."));
    assert!(content.contains("Inspect the diff before commenting."));

    let missing = run_runtime_tool_call(
        "skill",
        &root,
        "skill-2",
        &json!({ "type": "tool-call", "toolCallId": "skill-2", "name": "skill", "original": { "skillName": "missing" }, "parsed": { "skillName": "missing" } }),
        &json!({
            "skillName": "missing",
            "userName": "Octo",
            "skills": [{
                "name": "review-code",
                "description": "Reviews source changes.",
                "instructions": "Inspect the diff before commenting.",
                "path": "/home/user/.config/agents/skills/review-code",
                "skillFilePath": "/home/user/.config/agents/skills/review-code/SKILL.md"
            }]
        }),
    )
    .expect("missing skill should render text output");
    assert_eq!(
        missing["content"][0]["content"],
        json!("Unknown skill: missing")
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn runs_runtime_fetch_tool_calls() {
    let server = TestHttpServer::start(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: 52\r\n\r\n<html><body><h1>Hello</h1><p>World</p></body></html>",
    );
    let root = unique_temp_dir("octofriend-tools-fetch-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let output = run_runtime_tool_call(
        "fetch",
        &root,
        "fetch-1",
        &json!({ "type": "tool-call", "toolCallId": "fetch-1", "name": "fetch", "original": { "url": server.url() }, "parsed": { "url": server.url() } }),
        &json!({ "url": server.url(), "modelContext": 200 }),
    )
    .expect("fetch should run");
    assert_eq!(output["type"], json!("output"));
    assert_eq!(output["content"][0]["content"], json!("HELLO\n\nWorld"));

    let markup_server = TestHttpServer::start(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: 52\r\n\r\n<html><body><h1>Hello</h1><p>World</p></body></html>",
    );
    let markup = run_runtime_tool_call(
        "fetch",
        &root,
        "fetch-2",
        &json!({ "type": "tool-call", "toolCallId": "fetch-2", "name": "fetch", "original": { "url": markup_server.url(), "includeMarkup": true }, "parsed": { "url": markup_server.url(), "includeMarkup": true } }),
        &json!({ "url": markup_server.url(), "includeMarkup": true, "modelContext": 200 }),
    )
    .expect("fetch with markup should run");
    assert_eq!(
        markup["content"][0]["content"],
        json!("<html><body><h1>Hello</h1><p>World</p></body></html>")
    );

    let large_server = TestHttpServer::start(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: 11\r\n\r\nhello world",
    );
    let large = run_runtime_tool_call(
        "fetch",
        &root,
        "fetch-3",
        &json!({ "type": "tool-call", "toolCallId": "fetch-3", "name": "fetch", "original": { "url": large_server.url() }, "parsed": { "url": large_server.url() } }),
        &json!({ "url": large_server.url(), "includeMarkup": true, "modelContext": 5 }),
    );
    assert_eq!(
        large,
        Err("Web content too large: 11 bytes (max: 5 bytes)".into())
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

#[test]
fn runs_runtime_web_search_tool_calls() {
    let server = TestHttpServer::start(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: 89\r\n\r\n{\"results\":[{\"url\":\"https://example.com/a\",\"title\":\"A\",\"text\":\"Alpha\",\"published\":null}]}",
    );
    let root = unique_temp_dir("octofriend-tools-web-search-run");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let output = run_runtime_tool_call(
        "web-search",
        &root,
        "search-1",
        &json!({ "type": "tool-call", "toolCallId": "search-1", "name": "web-search", "original": { "query": "octofriend" }, "parsed": { "query": "octofriend" } }),
        &json!({ "query": "octofriend", "searchUrl": server.url(), "searchKey": "search-key", "modelContext": 65536 }),
    )
    .expect("web-search should run");

    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": "{\"url\":\"https://example.com/a\",\"title\":\"A\",\"text\":\"Alpha\",\"published\":null}" }],
            "lines": null
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn rejects_oversized_runtime_web_search_responses() {
    let server = TestHttpServer::start(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: 89\r\n\r\n{\"results\":[{\"url\":\"https://example.com/a\",\"title\":\"A\",\"text\":\"Alpha\",\"published\":null}]}",
    );
    let root = unique_temp_dir("octofriend-tools-web-search-size");
    std::fs::create_dir_all(&root).expect("temp dir should be created");

    let error = run_runtime_tool_call(
        "web-search",
        &root,
        "search-size",
        &json!({ "type": "tool-call", "toolCallId": "search-size", "name": "web-search", "original": { "query": "octofriend" }, "parsed": { "query": "octofriend" } }),
        &json!({ "query": "octofriend", "searchUrl": server.url(), "searchKey": "search-key", "modelContext": 32 }),
    )
    .expect_err("oversized web-search output should be rejected");

    assert!(error.starts_with("Web search response too large: 89 bytes (max: 32 bytes)."));
    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn runs_runtime_grep_tool_calls() {
    let root = unique_temp_dir("octofriend-tools-grep-run");
    std::fs::create_dir_all(root.join("src/nested")).expect("fixture dirs should be created");
    std::fs::write(root.join("src/a.txt"), "alpha\nBeta\nalpha again\n")
        .expect("a fixture should be written");
    std::fs::write(root.join("src/nested/b.txt"), "beta\n").expect("b fixture should be written");

    let output = run_runtime_tool_call(
        "grep",
        &root,
        "grep-1",
        &json!({ "type": "tool-call", "toolCallId": "grep-1", "name": "grep", "original": { "pattern": "alpha", "path": "src", "maxResults": 1 }, "parsed": { "pattern": "alpha", "path": "src", "maxResults": 1 } }),
        &json!({ "pattern": "alpha", "path": "src", "maxResults": 1 }),
    )
    .expect("grep should run");
    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": "src/a.txt:1:alpha" }],
            "lines": null
        })
    );

    let case_insensitive = run_runtime_tool_call(
        "grep",
        &root,
        "grep-2",
        &json!({ "type": "tool-call", "toolCallId": "grep-2", "name": "grep", "original": { "pattern": "BETA", "path": "src", "caseInsensitive": true }, "parsed": { "pattern": "BETA", "path": "src", "caseInsensitive": true } }),
        &json!({ "pattern": "BETA", "path": "src", "caseInsensitive": true }),
    )
    .expect("case-insensitive grep should run");
    assert!(
        case_insensitive["content"][0]["content"]
            .as_str()
            .unwrap()
            .contains("src/a.txt:2:Beta")
    );

    let no_matches = run_runtime_tool_call(
        "grep",
        &root,
        "grep-3",
        &json!({ "type": "tool-call", "toolCallId": "grep-3", "name": "grep", "original": { "pattern": "missing", "path": "src" }, "parsed": { "pattern": "missing", "path": "src" } }),
        &json!({ "pattern": "missing", "path": "src" }),
    )
    .expect("grep without matches should produce empty output");
    assert_eq!(
        no_matches,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": "" }],
            "lines": null
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

#[test]
fn runs_runtime_glob_tool_calls() {
    let root = unique_temp_dir("octofriend-tools-glob-run");
    std::fs::create_dir_all(root.join("src/nested")).expect("fixture dirs should be created");
    std::fs::create_dir_all(root.join("node_modules/pkg")).expect("excluded dir should be created");
    std::fs::write(root.join("src/main.ts"), "main").expect("main fixture should be written");
    std::fs::write(root.join("src/nested/util.test.ts"), "test")
        .expect("test fixture should be written");
    std::fs::write(root.join("src/nested/util.rs"), "source")
        .expect("source fixture should be written");
    std::fs::write(root.join("node_modules/pkg/ignored.ts"), "ignored")
        .expect("ignored fixture should be written");

    let output = run_runtime_tool_call(
        "glob",
        &root,
        "glob-1",
        &json!({ "type": "tool-call", "toolCallId": "glob-1", "name": "glob", "original": { "path": "src", "includeName": "*.ts", "excludePath": "*/nested/*" }, "parsed": { "path": "src", "includeName": "*.ts", "excludePath": "*/nested/*" } }),
        &json!({ "path": "src", "includeName": "*.ts", "excludePath": "*/nested/*" }),
    )
    .expect("glob should run");

    assert_eq!(
        output,
        json!({
            "type": "output",
            "content": [{ "type": "text", "content": "main.ts" }],
            "lines": null
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}
