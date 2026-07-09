use octofwen_protocol::acp::{
    AgentClientAudioContent, AgentClientCapabilities, AgentClientContentBlock,
    AgentClientContentChunk, AgentClientFileSystemCapabilities, AgentClientImageContent,
    AgentClientInitializeInput, AgentClientMcpServer, AgentClientNameValue,
    AgentClientNewSessionRequest, AgentClientPeerInfo, AgentClientPermissionOption,
    AgentClientPermissionOptionKind, AgentClientPromptRequest, AgentClientReadTextFileRequest,
    AgentClientRequestPermissionRequest, AgentClientSessionCapabilities, AgentClientSessionUpdate,
    AgentClientStdioMcpServer, AgentClientToolCallLocation, AgentClientToolCallStatus,
    AgentClientToolCallUpdate, AgentClientWriteTextFileRequest,
    create_agent_client_initialize_request, create_agent_client_new_session_request,
    create_agent_client_prompt_request, create_agent_client_read_text_file_request,
    create_agent_client_request_permission_request, create_agent_client_session_notification,
    create_agent_client_write_text_file_request,
};
use octofwen_protocol::json_rpc::JsonRpcId;
use serde_json::json;
#[test]
fn initialize_and_prompt_requests_match_agent_client_protocol_schema() {
    let initialize = create_agent_client_initialize_request(
        JsonRpcId::String("init-conformance".to_owned()),
        AgentClientInitializeInput {
            client_info: AgentClientPeerInfo {
                name: "octofwen".to_owned(),
                title: None,
                version: Some("0.0.0".to_owned()),
            },
            capabilities: AgentClientCapabilities {
                fs: Some(AgentClientFileSystemCapabilities {
                    read_text_file: Some(true),
                    write_text_file: Some(true),
                }),
                terminal: Some(true),
                session: Some(AgentClientSessionCapabilities {
                    config_options: Some(json!({ "boolean": {} })),
                    meta: None,
                }),
                meta: None,
            },
        },
    );
    let initialize_params = initialize.params.expect("initialize should have params");
    let upstream_initialize: agent_client_protocol_schema::v1::InitializeRequest =
        serde_json::from_value(initialize_params.clone())
            .expect("local initialize params should fit ACP schema crate");

    assert_eq!(upstream_initialize.protocol_version, 1.into());
    assert_eq!(
        upstream_initialize
            .client_info
            .as_ref()
            .expect("client info should deserialize")
            .name,
        "octofwen"
    );
    assert_eq!(
        serde_json::to_value(upstream_initialize).expect("serialize upstream initialize"),
        initialize_params
    );

    let prompt = create_agent_client_prompt_request(
        JsonRpcId::String("prompt-conformance".to_owned()),
        AgentClientPromptRequest::new("session-1", vec![AgentClientContentBlock::text("hello")]),
    );
    let prompt_params = prompt.params.expect("prompt should have params");
    let upstream_prompt: agent_client_protocol_schema::v1::PromptRequest =
        serde_json::from_value(prompt_params.clone())
            .expect("local prompt params should fit ACP schema crate");

    assert_eq!(upstream_prompt.session_id.0.as_ref(), "session-1");
    assert_eq!(upstream_prompt.prompt.len(), 1);
    assert_eq!(
        serde_json::to_value(upstream_prompt).expect("serialize upstream prompt"),
        prompt_params
    );
}

#[test]
fn multimodal_prompt_content_matches_agent_client_protocol_schema() {
    let prompt = create_agent_client_prompt_request(
        JsonRpcId::String("multimodal-prompt-conformance".to_owned()),
        AgentClientPromptRequest::new(
            "session-1",
            vec![
                AgentClientContentBlock::Image(AgentClientImageContent {
                    uri: Some("file:///repo/screenshot.png".to_owned()),
                    ..AgentClientImageContent::new("iVBORw0KGgo=", "image/png")
                }),
                AgentClientContentBlock::Audio(AgentClientAudioContent::new(
                    "UklGRg==",
                    "audio/wav",
                )),
            ],
        ),
    );
    let prompt_params = prompt.params.expect("prompt should have params");
    let upstream_prompt: agent_client_protocol_schema::v1::PromptRequest =
        serde_json::from_value(prompt_params.clone())
            .expect("local multimodal prompt should fit ACP schema crate");

    assert_eq!(upstream_prompt.session_id.0.as_ref(), "session-1");
    assert_eq!(upstream_prompt.prompt.len(), 2);
    assert_eq!(
        serde_json::to_value(upstream_prompt).expect("serialize upstream multimodal prompt"),
        prompt_params
    );
}

#[test]
fn client_side_requests_match_agent_client_protocol_schema() {
    let read = create_agent_client_read_text_file_request(
        JsonRpcId::String("read-conformance".to_owned()),
        AgentClientReadTextFileRequest {
            line: Some(7),
            limit: Some(12),
            ..AgentClientReadTextFileRequest::new("session-1", "/repo/src/main.rs")
        },
    );
    let read_params = read.params.expect("fs/read_text_file should have params");
    let upstream_read: agent_client_protocol_schema::v1::ReadTextFileRequest =
        serde_json::from_value(read_params.clone())
            .expect("local fs/read_text_file params should fit ACP schema crate");
    assert_eq!(upstream_read.session_id.0.as_ref(), "session-1");
    assert_eq!(upstream_read.path.to_string_lossy(), "/repo/src/main.rs");
    assert_eq!(upstream_read.line, Some(7));
    assert_eq!(upstream_read.limit, Some(12));
    assert_eq!(
        serde_json::to_value(upstream_read).expect("serialize upstream read request"),
        read_params
    );

    let write = create_agent_client_write_text_file_request(
        JsonRpcId::String("write-conformance".to_owned()),
        AgentClientWriteTextFileRequest::new("session-1", "/repo/src/main.rs", "fn main() {}"),
    );
    let write_params = write.params.expect("fs/write_text_file should have params");
    let upstream_write: agent_client_protocol_schema::v1::WriteTextFileRequest =
        serde_json::from_value(write_params.clone())
            .expect("local fs/write_text_file params should fit ACP schema crate");
    assert_eq!(upstream_write.session_id.0.as_ref(), "session-1");
    assert_eq!(upstream_write.path.to_string_lossy(), "/repo/src/main.rs");
    assert_eq!(upstream_write.content, "fn main() {}");
    assert_eq!(
        serde_json::to_value(upstream_write).expect("serialize upstream write request"),
        write_params
    );

    let permission = create_agent_client_request_permission_request(
        JsonRpcId::String("permission-conformance".to_owned()),
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
    let permission_params = permission
        .params
        .expect("session/request_permission should have params");
    let upstream_permission: agent_client_protocol_schema::v1::RequestPermissionRequest =
        serde_json::from_value(permission_params.clone())
            .expect("local session/request_permission params should fit ACP schema crate");
    assert_eq!(upstream_permission.session_id.0.as_ref(), "session-1");
    assert_eq!(
        upstream_permission.tool_call.tool_call_id.0.as_ref(),
        "call-1"
    );
    assert_eq!(upstream_permission.options.len(), 1);
    assert_eq!(
        serde_json::to_value(upstream_permission).expect("serialize upstream permission request"),
        permission_params
    );
}

#[test]
fn session_update_notification_matches_agent_client_protocol_schema() {
    let notification = create_agent_client_session_notification(
        "session-1",
        AgentClientSessionUpdate::AgentMessageChunk(AgentClientContentChunk {
            content: AgentClientContentBlock::text("done"),
            message_id: Some("msg-1".to_owned()),
            meta: None,
        }),
    );
    let value = serde_json::to_value(notification).expect("serialize local notification");
    let upstream: agent_client_protocol_schema::v1::SessionNotification =
        serde_json::from_value(value.clone())
            .expect("local session/update notification should fit ACP schema crate");

    assert_eq!(upstream.session_id.0.as_ref(), "session-1");
    assert_eq!(
        serde_json::to_value(upstream).expect("serialize upstream notification"),
        value
    );
}

#[test]
fn tool_call_session_updates_match_agent_client_protocol_schema() {
    let notification = create_agent_client_session_notification(
        "session-1",
        AgentClientSessionUpdate::ToolCallUpdate(AgentClientToolCallUpdate {
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
        }),
    );
    let value = serde_json::to_value(notification).expect("serialize local tool update");
    assert!(
        value["update"]["locations"][0].get("column").is_none(),
        "ACP v1 ToolCallLocation has no column field"
    );
    let upstream: agent_client_protocol_schema::v1::SessionNotification =
        serde_json::from_value(value.clone())
            .expect("local tool call update notification should fit ACP schema crate");

    assert_eq!(upstream.session_id.0.as_ref(), "session-1");
    assert_eq!(
        serde_json::to_value(upstream).expect("serialize upstream tool call update"),
        value
    );
}

#[test]
fn new_session_request_matches_agent_client_protocol_schema() {
    let request = create_agent_client_new_session_request(
        JsonRpcId::String("session-conformance".to_owned()),
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
    let params = request.params.expect("session/new should have params");
    let upstream: agent_client_protocol_schema::v1::NewSessionRequest =
        serde_json::from_value(params.clone())
            .expect("local session/new params should fit ACP schema crate");

    assert_eq!(upstream.cwd.to_string_lossy(), "/repo");
    assert_eq!(upstream.additional_directories.len(), 1);
    assert_eq!(upstream.mcp_servers.len(), 1);
    assert_eq!(
        serde_json::to_value(upstream).expect("serialize upstream session"),
        params
    );
}
