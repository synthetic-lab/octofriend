use octofwen_protocol::acp::{
    AGENT_CLIENT_AGENT_METHODS, AGENT_CLIENT_AGENT_NOTIFICATIONS, AGENT_CLIENT_CLIENT_METHODS,
    AGENT_CLIENT_CLIENT_NOTIFICATIONS, AGENT_CLIENT_PROTOCOL_VERSION, AgentClientCapabilities,
    AgentClientFileSystemCapabilities, AgentClientInitializeInput, AgentClientPeerInfo,
    create_agent_client_initialize_request, is_absolute_agent_client_path, is_agent_client_method,
    is_agent_client_protocol_version, is_one_based_line_number,
};
use octofwen_protocol::json_rpc::JsonRpcId;
use serde as _;
use serde_json::json;

#[test]
fn names_protocol_version_and_baseline_method_sets() {
    assert_eq!(AGENT_CLIENT_PROTOCOL_VERSION, 1);
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"initialize"));
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"session/new"));
    assert!(AGENT_CLIENT_AGENT_METHODS.contains(&"session/prompt"));
    assert_eq!(AGENT_CLIENT_AGENT_NOTIFICATIONS, &["session/cancel"]);
    assert!(AGENT_CLIENT_CLIENT_METHODS.contains(&"session/request_permission"));
    assert!(AGENT_CLIENT_CLIENT_METHODS.contains(&"fs/read_text_file"));
    assert_eq!(AGENT_CLIENT_CLIENT_NOTIFICATIONS, &["session/update"]);
}

#[test]
fn creates_initialize_json_rpc_request_with_protocol_version_and_capabilities() {
    let request = create_agent_client_initialize_request(
        JsonRpcId::String("init-1".to_owned()),
        AgentClientInitializeInput {
            client_info: AgentClientPeerInfo {
                name: "octofwen".to_owned(),
                version: Some("0.0.0".to_owned()),
            },
            capabilities: AgentClientCapabilities {
                fs: Some(AgentClientFileSystemCapabilities {
                    read_text_file: Some(true),
                    write_text_file: None,
                }),
                terminal: None,
                load_session: None,
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
            "capabilities": { "fs": { "readTextFile": true } }
        }))
    );
}

#[test]
fn validates_protocol_conventions() {
    assert!(is_agent_client_protocol_version(1));
    assert!(!is_agent_client_protocol_version(2));
    assert!(is_agent_client_method("session/prompt"));
    assert!(!is_agent_client_method("unknown/method"));
    assert!(is_absolute_agent_client_path("/repo/file.ts"));
    assert!(!is_absolute_agent_client_path("relative/file.ts"));
    assert!(is_one_based_line_number(1));
    assert!(!is_one_based_line_number(0));
}
