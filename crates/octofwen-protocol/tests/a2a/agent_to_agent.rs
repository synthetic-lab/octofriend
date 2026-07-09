use octofwen_protocol::a2a::{
    AGENT_TO_AGENT_AGENT_CARD_PATH, AGENT_TO_AGENT_PROTOCOL_VERSION, AGENT_TO_AGENT_TRANSPORTS,
    AgentToAgentArtifact, AgentToAgentCapabilities, AgentToAgentCard, AgentToAgentCardInput,
    AgentToAgentMessage, AgentToAgentMessageRole, AgentToAgentPart, AgentToAgentProvider,
    AgentToAgentSendMessageConfiguration, AgentToAgentSkill, AgentToAgentStreamResponse,
    AgentToAgentTask, AgentToAgentTaskArtifactUpdateEvent, AgentToAgentTaskState,
    AgentToAgentTaskStatus, AgentToAgentTaskStatusUpdateEvent, create_agent_card,
    create_send_message_request, is_agent_to_agent_json_rpc_method, is_agent_to_agent_transport,
    is_valid_agent_card,
};
use octofwen_protocol::json_rpc::JsonRpcId;
use serde as _;
use serde_json::json;

#[test]
fn names_protocol_version_discovery_path_and_transports() {
    assert_eq!(AGENT_TO_AGENT_PROTOCOL_VERSION, "1.0");
    assert_eq!(
        AGENT_TO_AGENT_AGENT_CARD_PATH,
        "/.well-known/agent-card.json"
    );
    assert_eq!(
        AGENT_TO_AGENT_TRANSPORTS,
        &["JSONRPC", "HTTP+JSON", "GRPC", "SLIMRPC"]
    );
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
            extensions: Vec::new(),
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

    assert_eq!(
        card.supported_interfaces[0].url,
        "https://agent.example.test/a2a"
    );
    assert_eq!(card.supported_interfaces[0].protocol_binding, "JSONRPC");
    assert_eq!(card.supported_interfaces[0].protocol_version, "1.0");
    assert_eq!(card.capabilities.streaming, Some(true));
    assert!(is_valid_agent_card(&card));
    let card_json = serde_json::to_value(&card).expect("serialize card");
    assert_eq!(
        card_json["supportedInterfaces"],
        json!([{
            "url": "https://agent.example.test/a2a",
            "protocolBinding": "JSONRPC",
            "protocolVersion": "1.0"
        }])
    );
    assert!(card_json.get("protocolVersion").is_none());
    assert!(card_json.get("url").is_none());

    let mut invalid = card;
    invalid.skills.clear();
    assert!(!is_valid_agent_card(&invalid));
}

#[test]
fn serializes_a2a_provider_with_required_url() {
    assert_eq!(
        serde_json::to_value(AgentToAgentProvider {
            organization: "Synthetic Lab".to_owned(),
            url: "https://synthetic.new".to_owned(),
        })
        .expect("serialize provider"),
        json!({
            "organization": "Synthetic Lab",
            "url": "https://synthetic.new"
        })
    );
}

#[test]
fn deserializes_null_agent_card_skills_as_empty_vec() {
    let card = serde_json::from_value::<AgentToAgentCard>(json!({
        "name": "octofwen",
        "description": "Domain-owned coding agent",
        "version": "0.0.0",
        "supportedInterfaces": [{
            "url": "https://agent.example.test/a2a",
            "protocolBinding": "JSONRPC",
            "protocolVersion": "1.0"
        }],
        "capabilities": {},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": null
    }))
    .expect("deserialize card with null skills");

    assert!(card.skills.is_empty());
    assert!(!is_valid_agent_card(&card));
}

#[test]
fn creates_json_rpc_http_task_requests_and_validates_catalog_values() {
    assert!(is_agent_to_agent_transport("JSONRPC"));
    assert!(!is_agent_to_agent_transport("websocket"));
    assert!(is_agent_to_agent_json_rpc_method("SendMessage"));
    assert!(!is_agent_to_agent_json_rpc_method("UnknownMethod"));

    let request = create_send_message_request(
        JsonRpcId::String("task-1".to_owned()),
        AgentToAgentMessage {
            role: AgentToAgentMessageRole::User,
            message_id: "message-1".to_owned(),
            parts: vec![AgentToAgentPart::text("Summarize this repository")],
            context_id: None,
            task_id: None,
            metadata: None,
            extensions: Vec::new(),
            reference_task_ids: Vec::new(),
        },
        Some(AgentToAgentSendMessageConfiguration {
            return_immediately: Some(false),
            history_length: Some(20),
            accepted_output_modes: vec!["text/plain".to_owned()],
            task_push_notification_config: None,
        }),
    );

    assert_eq!(request.jsonrpc, "2.0");
    assert_eq!(request.id, JsonRpcId::String("task-1".to_owned()));
    assert_eq!(request.method, "SendMessage");
    assert_eq!(
        request.params,
        Some(json!({
            "message": {
                "role": "ROLE_USER",
                "messageId": "message-1",
                "parts": [{ "text": "Summarize this repository" }]
            },
            "configuration": {
                "returnImmediately": false,
                "historyLength": 20,
                "acceptedOutputModes": ["text/plain"]
            }
        }))
    );
}

#[test]
fn accepts_legacy_push_notification_config_alias() {
    let config = serde_json::from_value::<AgentToAgentSendMessageConfiguration>(json!({
        "pushNotificationConfig": { "url": "https://push.example.test" }
    }))
    .expect("deserialize legacy push notification alias");

    assert_eq!(
        config.task_push_notification_config,
        Some(json!({ "url": "https://push.example.test" }))
    );
}

#[test]
fn serializes_raw_parts_from_bytes_as_base64() {
    assert_eq!(
        serde_json::to_value(AgentToAgentPart::raw([0, 1, 2, 255])).expect("serialize raw part"),
        json!({ "raw": "AAEC/w==" })
    );
    assert_eq!(
        serde_json::to_value(AgentToAgentPart::base64_raw("AAEC/w==")).expect("serialize raw part"),
        json!({ "raw": "AAEC/w==" })
    );
}

#[test]
fn rejects_parts_without_exactly_one_content_field() {
    assert!(serde_json::from_value::<AgentToAgentPart>(json!({})).is_err());
    assert!(
        serde_json::from_value::<AgentToAgentPart>(json!({
            "text": "hello",
            "url": "https://example.test/file.txt"
        }))
        .is_err()
    );
    assert_eq!(
        serde_json::from_value::<AgentToAgentPart>(json!({
            "text": "hello",
            "metadata": { "source": "test" }
        }))
        .expect("deserialize valid text part"),
        AgentToAgentPart {
            text: Some("hello".to_owned()),
            raw: None,
            url: None,
            data: None,
            filename: None,
            media_type: None,
            metadata: Some(serde_json::Map::from_iter([(
                "source".to_owned(),
                json!("test")
            )])),
        }
    );
}

#[test]
fn serializes_a2a_task_status_and_history_with_protocol_names() {
    let task = AgentToAgentTask {
        id: "task-1".to_owned(),
        context_id: "context-1".to_owned(),
        status: AgentToAgentTaskStatus {
            state: AgentToAgentTaskState::Completed,
            message: None,
            timestamp: None,
        },
        artifacts: Vec::new(),
        history: vec![AgentToAgentMessage {
            role: AgentToAgentMessageRole::User,
            message_id: "message-1".to_owned(),
            parts: vec![AgentToAgentPart::text("hello")],
            context_id: Some("context-1".to_owned()),
            task_id: Some("task-1".to_owned()),
            metadata: None,
            extensions: Vec::new(),
            reference_task_ids: Vec::new(),
        }],
        metadata: None,
    };

    assert_eq!(
        serde_json::to_value(task).expect("serialize task"),
        json!({
            "id": "task-1",
            "contextId": "context-1",
            "status": { "state": "TASK_STATE_COMPLETED" },
            "history": [{
                "role": "ROLE_USER",
                "messageId": "message-1",
                "parts": [{ "text": "hello" }],
                "contextId": "context-1",
                "taskId": "task-1"
            }]
        })
    );
}

#[test]
fn send_message_request_matches_a2a_wire_schema() {
    let request = create_send_message_request(
        JsonRpcId::String("a2a-conformance".to_owned()),
        AgentToAgentMessage {
            role: AgentToAgentMessageRole::User,
            message_id: "message-1".to_owned(),
            parts: vec![AgentToAgentPart::text("hello")],
            context_id: Some("context-1".to_owned()),
            task_id: None,
            metadata: None,
            extensions: Vec::new(),
            reference_task_ids: Vec::new(),
        },
        Some(AgentToAgentSendMessageConfiguration {
            return_immediately: Some(true),
            history_length: Some(4),
            accepted_output_modes: vec!["text/plain".to_owned()],
            task_push_notification_config: None,
        }),
    );

    let params = request.params.expect("SendMessage should have params");
    let upstream: a2a::SendMessageRequest =
        serde_json::from_value(params.clone()).expect("local SendMessage params should fit a2a-lf");

    assert_eq!(upstream.message.message_id, "message-1");
    assert_eq!(upstream.message.role, a2a::Role::User);
    assert_eq!(upstream.message.text(), Some("hello"));
    assert_eq!(
        upstream
            .configuration
            .as_ref()
            .expect("configuration should deserialize")
            .accepted_output_modes,
        Some(vec!["text/plain".to_owned()])
    );
    assert_eq!(
        serde_json::to_value(upstream).expect("serialize upstream SendMessage"),
        params
    );
}

#[test]
fn agent_card_matches_a2a_wire_schema() {
    let card = create_agent_card(AgentToAgentCardInput {
        name: "octofwen".to_owned(),
        description: "Octofwen agent".to_owned(),
        url: "https://agent.example.test/a2a".to_owned(),
        version: "0.0.0".to_owned(),
        capabilities: AgentToAgentCapabilities {
            streaming: Some(true),
            push_notifications: None,
            extended_agent_card: None,
            extensions: Vec::new(),
        },
        default_input_modes: vec!["text/plain".to_owned()],
        default_output_modes: vec!["text/plain".to_owned()],
        skills: vec![AgentToAgentSkill {
            id: "coding".to_owned(),
            name: "Coding".to_owned(),
            description: "Modify code".to_owned(),
            tags: vec!["code".to_owned()],
            examples: None,
            input_modes: None,
            output_modes: None,
        }],
    });

    let value = serde_json::to_value(&card).expect("serialize local agent card");
    let upstream: a2a::AgentCard =
        serde_json::from_value(value.clone()).expect("local agent card should fit a2a-lf");

    assert_eq!(upstream.name, "octofwen");
    assert_eq!(
        upstream.supported_interfaces[0].protocol_version,
        a2a::VERSION
    );
    assert_eq!(
        serde_json::to_value(upstream).expect("serialize upstream card"),
        value
    );
}

#[test]
fn task_with_artifacts_and_history_matches_a2a_wire_schema() {
    let task = AgentToAgentTask {
        id: "task-1".to_owned(),
        context_id: "context-1".to_owned(),
        status: AgentToAgentTaskStatus {
            state: AgentToAgentTaskState::Working,
            message: Some(AgentToAgentMessage {
                role: AgentToAgentMessageRole::Agent,
                message_id: "status-message-1".to_owned(),
                parts: vec![AgentToAgentPart::text("working")],
                context_id: Some("context-1".to_owned()),
                task_id: Some("task-1".to_owned()),
                metadata: None,
                extensions: Vec::new(),
                reference_task_ids: Vec::new(),
            }),
            timestamp: None,
        },
        artifacts: vec![AgentToAgentArtifact {
            artifact_id: "artifact-1".to_owned(),
            name: Some("summary.txt".to_owned()),
            description: Some("Task summary".to_owned()),
            parts: vec![AgentToAgentPart::text("summary")],
            metadata: None,
            extensions: None,
        }],
        history: vec![AgentToAgentMessage {
            role: AgentToAgentMessageRole::User,
            message_id: "message-1".to_owned(),
            parts: vec![AgentToAgentPart::data(json!({ "request": "summarize" }))],
            context_id: Some("context-1".to_owned()),
            task_id: Some("task-1".to_owned()),
            metadata: None,
            extensions: Vec::new(),
            reference_task_ids: Vec::new(),
        }],
        metadata: None,
    };

    let value = serde_json::to_value(task).expect("serialize local task");
    let upstream: a2a::Task =
        serde_json::from_value(value.clone()).expect("local task should fit a2a-lf");

    assert_eq!(upstream.id, "task-1");
    assert_eq!(upstream.status.state, a2a::TaskState::Working);
    assert_eq!(
        upstream.artifacts.as_ref().expect("artifact")[0].artifact_id,
        "artifact-1"
    );
    assert_eq!(
        upstream.history.as_ref().expect("history")[0].role,
        a2a::Role::User
    );
    assert_eq!(
        serde_json::to_value(upstream).expect("serialize upstream task"),
        value
    );
}

#[test]
fn stream_response_events_match_a2a_wire_schema() {
    let status = AgentToAgentStreamResponse::StatusUpdate(AgentToAgentTaskStatusUpdateEvent {
        task_id: "task-1".to_owned(),
        context_id: "context-1".to_owned(),
        status: AgentToAgentTaskStatus {
            state: AgentToAgentTaskState::Working,
            message: Some(AgentToAgentMessage {
                role: AgentToAgentMessageRole::Agent,
                message_id: "message-1".to_owned(),
                parts: vec![AgentToAgentPart::text("working")],
                context_id: Some("context-1".to_owned()),
                task_id: Some("task-1".to_owned()),
                metadata: None,
                extensions: Vec::new(),
                reference_task_ids: Vec::new(),
            }),
            timestamp: None,
        },
        metadata: None,
    });

    let status_value = serde_json::to_value(status).expect("serialize local status event");
    let upstream_status: a2a::StreamResponse =
        serde_json::from_value(status_value.clone()).expect("local status event should fit a2a-lf");
    assert!(matches!(
        upstream_status,
        a2a::StreamResponse::StatusUpdate(_)
    ));
    assert_eq!(
        serde_json::to_value(upstream_status).expect("serialize upstream status event"),
        status_value
    );

    let artifact =
        AgentToAgentStreamResponse::ArtifactUpdate(AgentToAgentTaskArtifactUpdateEvent {
            task_id: "task-1".to_owned(),
            context_id: "context-1".to_owned(),
            artifact: AgentToAgentArtifact {
                artifact_id: "artifact-1".to_owned(),
                name: Some("summary.txt".to_owned()),
                description: None,
                parts: vec![AgentToAgentPart::text("summary")],
                metadata: None,
                extensions: None,
            },
            append: Some(true),
            last_chunk: Some(false),
            metadata: None,
        });

    let artifact_value = serde_json::to_value(artifact).expect("serialize local artifact event");
    let upstream_artifact: a2a::StreamResponse = serde_json::from_value(artifact_value.clone())
        .expect("local artifact event should fit a2a-lf");
    assert!(matches!(
        upstream_artifact,
        a2a::StreamResponse::ArtifactUpdate(_)
    ));
    assert_eq!(
        serde_json::to_value(upstream_artifact).expect("serialize upstream artifact event"),
        artifact_value
    );
}
