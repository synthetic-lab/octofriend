use octofwen_wire::acp::{
    AGENT_CLIENT_AGENT_METHODS, AGENT_CLIENT_AGENT_NOTIFICATIONS, AGENT_CLIENT_CLIENT_METHODS,
    AGENT_CLIENT_CLIENT_NOTIFICATIONS, AGENT_CLIENT_PROTOCOL_NOTIFICATIONS,
    AGENT_CLIENT_PROTOCOL_VERSION, AgentClientAgentCapabilities, AgentClientAudioContent,
    AgentClientAuthMethod, AgentClientCapabilities, AgentClientContentBlock,
    AgentClientEmbeddedResource, AgentClientEmbeddedResourceValue,
    AgentClientFileSystemCapabilities, AgentClientHttpMcpServer, AgentClientImageContent,
    AgentClientInitializeInput, AgentClientInitializeResponse, AgentClientMcpServer,
    AgentClientNameValue, AgentClientNewSessionRequest, AgentClientNewSessionResponse,
    AgentClientPeerInfo, AgentClientPermissionOption, AgentClientPermissionOptionKind,
    AgentClientPromptRequest, AgentClientReadTextFileRequest, AgentClientRequestPermissionRequest,
    AgentClientResourceLink, AgentClientSessionCapabilities, AgentClientSessionConfigBoolean,
    AgentClientSessionConfigKind, AgentClientSessionConfigOption,
    AgentClientSessionConfigOptionCategory, AgentClientSessionMode, AgentClientStdioMcpServer,
    AgentClientTextResourceContents, AgentClientToolCallLocation, AgentClientToolCallStatus,
    AgentClientToolCallUpdate, AgentClientWriteTextFileRequest,
    create_agent_client_initialize_request, create_agent_client_new_session_request,
    create_agent_client_prompt_request, create_agent_client_read_text_file_request,
    create_agent_client_request_permission_request, create_agent_client_write_text_file_request,
    is_absolute_agent_client_path, is_agent_client_method, is_agent_client_protocol_version,
    is_one_based_line_number,
};
use octofwen_wire::json_rpc::JsonRpcId;
use serde as _;
use serde_json::json;

#[test]
fn names_protocol_version_and_baseline_method_sets() {
    assert_eq!(AGENT_CLIENT_PROTOCOL_VERSION, 1);
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"initialize"));
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"session/new"));
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"session/prompt"));
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"session/list"));
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"session/close"));
    assert_eq!(AGENT_CLIENT_AGENT_NOTIFICATIONS, &["session/cancel"]);
    assert!(AGENT_CLIENT_CLIENT_METHODS.contains(&"session/request_permission"));
    assert!(AGENT_CLIENT_CLIENT_METHODS.contains(&"fs/read_text_file"));
    assert_eq!(AGENT_CLIENT_CLIENT_NOTIFICATIONS, &["session/update"]);
    assert_eq!(AGENT_CLIENT_PROTOCOL_NOTIFICATIONS, &["$/cancel_request"]);
    assert_eq!(
        AGENT_CLIENT_AGENT_METHODS
            .iter()
            .filter(|method| **method == "session/new")
            .count(),
        1
    );
}

#[test]
fn creates_initialize_json_rpc_request_with_protocol_version_and_capabilities() {
    let request = create_agent_client_initialize_request(
        JsonRpcId::String("init-1".to_owned()),
        AgentClientInitializeInput {
            client_info: AgentClientPeerInfo {
                name: "octofwen".to_owned(),
                title: None,
                version: Some("0.0.0".to_owned()),
            },
            capabilities: AgentClientCapabilities {
                fs: Some(AgentClientFileSystemCapabilities {
                    read_text_file: Some(true),
                    write_text_file: None,
                }),
                terminal: None,
                session: Some(AgentClientSessionCapabilities {
                    config_options: Some(json!({ "boolean": {} })),
                    meta: None,
                }),
                meta: None,
            },
        },
    );

    assert_eq!(request.jsonrpc, "2.0");
    assert_eq!(request.id, JsonRpcId::String("init-1".to_owned()));
    assert_eq!(request.method, "initialize");
    assert_eq!(
        request.params,
        Some(json!({
            "protocolVersion": 1,
            "clientInfo": { "name": "octofwen", "version": "0.0.0" },
            "clientCapabilities": {
                "fs": { "readTextFile": true },
                "session": { "configOptions": { "boolean": {} } }
            }
        }))
    );
}

#[test]
fn serializes_initialize_response_with_upstream_agent_info_and_auth_methods() {
    let response = AgentClientInitializeResponse {
        protocol_version: 1,
        agent_capabilities: AgentClientAgentCapabilities {
            load_session: Some(false),
            prompt_capabilities: Some(json!({ "image": true })),
            mcp_capabilities: Some(json!({ "http": true })),
            session_capabilities: Some(json!({ "fork": false })),
            auth: Some(json!({ "oauth": false })),
            meta: None,
        },
        agent_info: Some(AgentClientPeerInfo {
            name: "octofwen-agentd".to_owned(),
            title: Some("Octofwen Agentd".to_owned()),
            version: Some("0.0.0".to_owned()),
        }),
        auth_methods: vec![
            AgentClientAuthMethod::Agent,
            AgentClientAuthMethod::EnvVar {
                name: "OPENAI_API_KEY".to_owned(),
                description: Some("OpenAI API key".to_owned()),
            },
            AgentClientAuthMethod::Terminal,
        ],
    };

    assert_eq!(
        serde_json::to_value(response).expect("serialize initialize response"),
        json!({
            "protocolVersion": 1,
            "agentCapabilities": {
                "loadSession": false,
                "promptCapabilities": { "image": true },
                "mcpCapabilities": { "http": true },
                "sessionCapabilities": { "fork": false },
                "auth": { "oauth": false }
            },
            "agentInfo": {
                "name": "octofwen-agentd",
                "title": "Octofwen Agentd",
                "version": "0.0.0"
            },
            "authMethods": [
                { "type": "agent" },
                {
                    "type": "env_var",
                    "name": "OPENAI_API_KEY",
                    "description": "OpenAI API key"
                },
                { "type": "terminal" }
            ]
        })
    );

    let response_without_info = serde_json::to_value(AgentClientInitializeResponse {
        protocol_version: 1,
        agent_capabilities: AgentClientAgentCapabilities::default(),
        agent_info: None,
        auth_methods: Vec::new(),
    })
    .expect("serialize initialize response without agent info");

    assert!(response_without_info.get("agentInfo").is_none());
}

#[test]
fn creates_session_and_prompt_requests_with_acp_schema_names() {
    let session = create_agent_client_new_session_request(
        JsonRpcId::Number(1),
        AgentClientNewSessionRequest {
            cwd: "/repo".to_owned(),
            additional_directories: vec!["/repo/packages".to_owned()],
            mcp_servers: vec![AgentClientMcpServer::Stdio(AgentClientStdioMcpServer {
                args: vec!["--stdio".to_owned()],
                env: vec![AgentClientNameValue::new("TOKEN", "secret")],
                ..AgentClientStdioMcpServer::new("local-tools", "/bin/mcp")
            })],
            meta: None,
        },
    );
    assert_eq!(session.method, "session/new");
    assert_eq!(
        session.params,
        Some(json!({
            "cwd": "/repo",
            "additionalDirectories": ["/repo/packages"],
            "mcpServers": [{
                "name": "local-tools",
                "command": "/bin/mcp",
                "args": ["--stdio"],
                "env": [{ "name": "TOKEN", "value": "secret" }]
            }]
        }))
    );

    let prompt = create_agent_client_prompt_request(
        JsonRpcId::Number(2),
        AgentClientPromptRequest::new("session-1", vec![AgentClientContentBlock::text("hello")]),
    );
    assert_eq!(prompt.method, "session/prompt");
    assert_eq!(
        prompt.params,
        Some(json!({
            "sessionId": "session-1",
            "prompt": [{ "type": "text", "text": "hello" }]
        }))
    );
}

#[test]
fn serializes_new_session_response_with_modes_and_config_options() {
    let response = AgentClientNewSessionResponse {
        modes: vec![AgentClientSessionMode {
            id: "default".to_owned(),
            name: "Default".to_owned(),
            description: Some("Normal coding mode".to_owned()),
            meta: None,
        }],
        config_options: vec![AgentClientSessionConfigOption {
            id: "thinking".to_owned(),
            name: "Thinking".to_owned(),
            kind: AgentClientSessionConfigKind::Boolean(AgentClientSessionConfigBoolean {
                current_value: true,
            }),
            description: None,
            category: Some(AgentClientSessionConfigOptionCategory::ThoughtLevel),
            meta: None,
        }],
        ..AgentClientNewSessionResponse::new("session-1")
    };

    assert_eq!(
        serde_json::to_value(response).expect("serialize new session response"),
        json!({
            "sessionId": "session-1",
            "modes": [{
                "id": "default",
                "name": "Default",
                "description": "Normal coding mode"
            }],
            "configOptions": [{
                "id": "thinking",
                "name": "Thinking",
                "type": "boolean",
                "currentValue": true,
                "category": "thought_level"
            }]
        })
    );
}

#[test]
fn serializes_typed_acp_mcp_servers_and_content_blocks() {
    assert_eq!(
        serde_json::to_value(AgentClientMcpServer::Http(AgentClientHttpMcpServer {
            headers: vec![AgentClientNameValue::new("Authorization", "Bearer token")],
            ..AgentClientHttpMcpServer::new("remote-tools", "https://mcp.example.test")
        }))
        .expect("serialize mcp server"),
        json!({
            "type": "http",
            "name": "remote-tools",
            "url": "https://mcp.example.test",
            "headers": [{ "name": "Authorization", "value": "Bearer token" }]
        })
    );

    let blocks = vec![
        AgentClientContentBlock::Image(AgentClientImageContent::new("aW1hZ2U=", "image/png")),
        AgentClientContentBlock::Audio(AgentClientAudioContent::new("YXVkaW8=", "audio/wav")),
        AgentClientContentBlock::ResourceLink(AgentClientResourceLink::new(
            "README",
            "file:///repo/README.md",
        )),
        AgentClientContentBlock::Resource(AgentClientEmbeddedResource::new(
            AgentClientEmbeddedResourceValue::Text(AgentClientTextResourceContents {
                text: "hello".to_owned(),
                uri: "file:///repo/context.txt".to_owned(),
                mime_type: Some("text/plain".to_owned()),
                meta: None,
            }),
        )),
    ];

    assert_eq!(
        serde_json::to_value(blocks).expect("serialize content blocks"),
        json!([
            { "type": "image", "data": "aW1hZ2U=", "mimeType": "image/png" },
            { "type": "audio", "data": "YXVkaW8=", "mimeType": "audio/wav" },
            { "type": "resource_link", "name": "README", "uri": "file:///repo/README.md" },
            {
                "type": "resource",
                "resource": {
                    "text": "hello",
                    "uri": "file:///repo/context.txt",
                    "mimeType": "text/plain"
                }
            }
        ])
    );
}

#[test]
fn creates_client_side_fs_and_permission_requests_with_acp_method_names() {
    let read = create_agent_client_read_text_file_request(
        JsonRpcId::Number(3),
        AgentClientReadTextFileRequest {
            line: Some(7),
            limit: Some(12),
            ..AgentClientReadTextFileRequest::new("session-1", "/repo/src/main.rs")
        },
    );
    assert_eq!(read.method, "fs/read_text_file");
    assert_eq!(
        read.params,
        Some(json!({
            "sessionId": "session-1",
            "path": "/repo/src/main.rs",
            "line": 7,
            "limit": 12
        }))
    );

    let write = create_agent_client_write_text_file_request(
        JsonRpcId::Number(4),
        AgentClientWriteTextFileRequest::new("session-1", "/repo/src/main.rs", "fn main() {}"),
    );
    assert_eq!(write.method, "fs/write_text_file");
    assert_eq!(
        write.params,
        Some(json!({
            "sessionId": "session-1",
            "path": "/repo/src/main.rs",
            "content": "fn main() {}"
        }))
    );

    let permission = create_agent_client_request_permission_request(
        JsonRpcId::Number(5),
        AgentClientRequestPermissionRequest::new(
            "session-1",
            AgentClientToolCallUpdate {
                status: Some(AgentClientToolCallStatus::Pending),
                ..AgentClientToolCallUpdate::new("call-1")
            },
            vec![AgentClientPermissionOption::new(
                "allow",
                "Allow once",
                AgentClientPermissionOptionKind::AllowOnce,
            )],
        ),
    );
    assert_eq!(permission.method, "session/request_permission");
    assert_eq!(
        permission.params,
        Some(json!({
            "sessionId": "session-1",
            "toolCall": { "toolCallId": "call-1", "status": "pending" },
            "options": [{
                "optionId": "allow",
                "name": "Allow once",
                "kind": "allow_once"
            }]
        }))
    );
}

#[test]
fn serializes_tool_call_updates_with_content_locations_and_raw_io() {
    let update = AgentClientToolCallUpdate {
        title: Some("Read file".to_owned()),
        kind: Some("read".to_owned()),
        status: Some(AgentClientToolCallStatus::Completed),
        content: vec![AgentClientContentBlock::text("done")],
        locations: vec![AgentClientToolCallLocation {
            path: "/repo/src/main.rs".to_owned(),
            line: Some(7),
            column: Some(3),
            meta: None,
        }],
        raw_input: Some(json!({ "path": "/repo/src/main.rs" })),
        raw_output: Some(json!({ "ok": true })),
        ..AgentClientToolCallUpdate::new("call-1")
    };

    assert_eq!(
        serde_json::to_value(update).expect("serialize tool call update"),
        json!({
            "toolCallId": "call-1",
            "title": "Read file",
            "kind": "read",
            "status": "completed",
            "content": [{
                "type": "content",
                "content": { "type": "text", "text": "done" }
            }],
            "locations": [{
                "path": "/repo/src/main.rs",
                "line": 7
            }],
            "rawInput": { "path": "/repo/src/main.rs" },
            "rawOutput": { "ok": true }
        })
    );
}

#[test]
fn validates_protocol_conventions() {
    assert!(is_agent_client_protocol_version(1));
    assert!(!is_agent_client_protocol_version(2));
    assert!(is_agent_client_method("session/prompt"));
    assert!(is_agent_client_method("$/cancel_request"));
    assert!(!is_agent_client_method("unknown/method"));
    assert!(is_absolute_agent_client_path("/repo/file.ts"));
    assert!(!is_absolute_agent_client_path("relative/file.ts"));
    assert!(is_one_based_line_number(1));
    assert!(!is_one_based_line_number(0));
}
