use octofwen_wire::a2a::{
    AgentToAgentMessage, AgentToAgentMessageRole, AgentToAgentPart, AgentToAgentStreamResponse,
    AgentToAgentTask, AgentToAgentTaskState, AgentToAgentTaskStatus,
};
use serde_json::json;

#[test]
fn stream_response_task_and_message_variants_match_a2a_wire_schema() {
    let task = AgentToAgentStreamResponse::Task(AgentToAgentTask {
        id: "task-1".to_owned(),
        context_id: "context-1".to_owned(),
        status: AgentToAgentTaskStatus {
            state: AgentToAgentTaskState::Submitted,
            message: None,
            timestamp: None,
        },
        artifacts: Vec::new(),
        history: Vec::new(),
        metadata: None,
    });
    let task_value = serde_json::to_value(task).expect("serialize local task stream response");
    let upstream_task: a2a::StreamResponse =
        serde_json::from_value(task_value.clone()).expect("local task event should fit a2a-lf");

    assert!(matches!(upstream_task, a2a::StreamResponse::Task(_)));
    assert_eq!(
        serde_json::to_value(upstream_task).expect("serialize upstream task event"),
        task_value
    );

    let message = AgentToAgentStreamResponse::Message(AgentToAgentMessage {
        role: AgentToAgentMessageRole::Agent,
        message_id: "message-1".to_owned(),
        parts: vec![AgentToAgentPart::text("ready")],
        context_id: Some("context-1".to_owned()),
        task_id: Some("task-1".to_owned()),
        metadata: Some(serde_json::Map::from_iter([(
            "channel".to_owned(),
            json!("stream"),
        )])),
        extensions: Vec::new(),
        reference_task_ids: Vec::new(),
    });
    let message_value =
        serde_json::to_value(message).expect("serialize local message stream response");
    let upstream_message: a2a::StreamResponse = serde_json::from_value(message_value.clone())
        .expect("local message event should fit a2a-lf");

    assert!(matches!(upstream_message, a2a::StreamResponse::Message(_)));
    assert_eq!(
        serde_json::to_value(upstream_message).expect("serialize upstream message event"),
        message_value
    );
}
