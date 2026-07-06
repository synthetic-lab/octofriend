use octofwen_protocol::a2a::{
    AGENT_TO_AGENT_AGENT_CARD_PATH, AGENT_TO_AGENT_PROTOCOL_VERSION, AGENT_TO_AGENT_TRANSPORTS,
    AgentToAgentCapabilities, AgentToAgentCardInput, AgentToAgentMessage, AgentToAgentMessageRole,
    AgentToAgentPart, AgentToAgentSkill, create_agent_card, create_send_message_request,
    is_agent_to_agent_json_rpc_method, is_agent_to_agent_transport, is_valid_agent_card,
};
use octofwen_protocol::json_rpc::JsonRpcId;
use serde as _;
use serde_json::json;

#[test]
fn names_protocol_version_discovery_path_and_transports() {
    assert_eq!(AGENT_TO_AGENT_PROTOCOL_VERSION, "1.0.0");
    assert_eq!(
        AGENT_TO_AGENT_AGENT_CARD_PATH,
        "/.well-known/agent-card.json"
    );
    assert_eq!(AGENT_TO_AGENT_TRANSPORTS, &["jsonrpc-http", "sse"]);
}

#[test]
fn creates_and_validates_agent_cards() {
    let card = create_agent_card(AgentToAgentCardInput {
        name: "octofwen".to_owned(),
        description: "Domain-owned coding agent".to_owned(),
        url: "https://agent.example.test/a2a".to_owned(),
        version: "0.0.0".to_owned(),
        capabilities: AgentToAgentCapabilities {
            streaming: Some(true),
            push_notifications: Some(false),
            extended_agent_card: None,
        },
        default_input_modes: vec!["text/plain".to_owned()],
        default_output_modes: vec!["text/plain".to_owned(), "application/json".to_owned()],
        skills: vec![AgentToAgentSkill {
            id: "code-editing".to_owned(),
            name: "Code editing".to_owned(),
            description: "Modify files in a repository".to_owned(),
            tags: vec!["code".to_owned()],
            examples: None,
            input_modes: None,
            output_modes: None,
        }],
    });

    assert_eq!(card.protocol_version, "1.0.0");
    assert_eq!(card.capabilities.streaming, Some(true));
    assert!(is_valid_agent_card(&card));

    let mut invalid = card;
    invalid.skills.clear();
    assert!(!is_valid_agent_card(&invalid));
}

#[test]
fn creates_json_rpc_http_task_requests_and_validates_catalog_values() {
    assert!(is_agent_to_agent_transport("jsonrpc-http"));
    assert!(!is_agent_to_agent_transport("websocket"));
    assert!(is_agent_to_agent_json_rpc_method("SendMessage"));
    assert!(!is_agent_to_agent_json_rpc_method("UnknownMethod"));

    let request = create_send_message_request(
        JsonRpcId::String("task-1".to_owned()),
        AgentToAgentMessage {
            role: AgentToAgentMessageRole::User,
            parts: vec![AgentToAgentPart::Text {
                text: "Summarize this repository".to_owned(),
            }],
            message_id: None,
            context_id: None,
            task_id: None,
        },
        None,
        None,
    );

    assert_eq!(request.jsonrpc, "2.0");
    assert_eq!(request.id, JsonRpcId::String("task-1".to_owned()));
    assert_eq!(request.method, "SendMessage");
    assert_eq!(
        request.params,
        Some(json!({
            "message": {
                "role": "user",
                "parts": [{ "kind": "text", "text": "Summarize this repository" }]
            }
        }))
    );
}
