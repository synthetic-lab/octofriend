use octofriend_wire::acp::{
    AgentClientAvailableCommand, AgentClientAvailableCommandsUpdate, AgentClientConfigOptionUpdate,
    AgentClientContentBlock, AgentClientContentChunk, AgentClientCurrentModeUpdate,
    AgentClientMaybeString, AgentClientPlan, AgentClientPlanEntry, AgentClientPlanEntryPriority,
    AgentClientPlanEntryStatus, AgentClientSessionConfigBoolean, AgentClientSessionConfigKind,
    AgentClientSessionConfigOption, AgentClientSessionConfigOptionCategory,
    AgentClientSessionInfoUpdate, AgentClientSessionUpdate, AgentClientUsageUpdate,
    create_agent_client_session_notification,
};
use serde_json::json;
#[test]
fn serializes_session_update_notifications_with_acp_discriminators() {
    let notification = create_agent_client_session_notification(
        "session-1",
        AgentClientSessionUpdate::AgentMessageChunk(AgentClientContentChunk {
            content: AgentClientContentBlock::text("done"),
            message_id: Some("msg-1".to_owned()),
            meta: None,
        }),
    );

    assert_eq!(
        serde_json::to_value(notification).expect("serialize notification"),
        json!({
            "sessionId": "session-1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "done" },
                "messageId": "msg-1"
            }
        })
    );
}

fn session_update_json(update: AgentClientSessionUpdate) -> serde_json::Result<serde_json::Value> {
    serde_json::to_value(update)
}

#[test]
fn serializes_plan_and_command_session_updates_with_acp_discriminators() -> serde_json::Result<()> {
    assert_eq!(
        session_update_json(AgentClientSessionUpdate::Plan(AgentClientPlan {
            entries: vec![AgentClientPlanEntry {
                content: "Ship protocol parity".to_owned(),
                priority: AgentClientPlanEntryPriority::High,
                status: AgentClientPlanEntryStatus::InProgress,
                meta: None,
            }],
            meta: None,
        }))?,
        json!({
            "sessionUpdate": "plan",
            "entries": [{
                "content": "Ship protocol parity",
                "priority": "high",
                "status": "in_progress"
            }]
        })
    );

    assert_eq!(
        session_update_json(AgentClientSessionUpdate::AvailableCommandsUpdate(
            AgentClientAvailableCommandsUpdate {
                available_commands: vec![AgentClientAvailableCommand {
                    name: "create_plan".to_owned(),
                    description: "Create an execution plan".to_owned(),
                    input: None,
                    meta: None,
                }],
                meta: None,
            },
        ))?,
        json!({
            "sessionUpdate": "available_commands_update",
            "availableCommands": [{
                "name": "create_plan",
                "description": "Create an execution plan"
            }]
        })
    );
    Ok(())
}

#[test]
fn serializes_mode_usage_and_session_info_updates_with_acp_discriminators() -> serde_json::Result<()>
{
    assert_eq!(
        session_update_json(AgentClientSessionUpdate::CurrentModeUpdate(
            AgentClientCurrentModeUpdate {
                current_mode_id: "default".to_owned(),
                meta: None,
            },
        ))?,
        json!({
            "sessionUpdate": "current_mode_update",
            "currentModeId": "default"
        })
    );

    assert_eq!(
        session_update_json(AgentClientSessionUpdate::UsageUpdate(
            AgentClientUsageUpdate {
                used: 128,
                size: 4096,
                cost: None,
                meta: None,
            },
        ))?,
        json!({
            "sessionUpdate": "usage_update",
            "used": 128,
            "size": 4096
        })
    );

    assert_eq!(
        session_update_json(AgentClientSessionUpdate::SessionInfoUpdate(
            AgentClientSessionInfoUpdate {
                title: AgentClientMaybeString::from("New title"),
                updated_at: AgentClientMaybeString::null(),
                meta: None,
            },
        ))?,
        json!({
            "sessionUpdate": "session_info_update",
            "title": "New title",
            "updatedAt": null
        })
    );

    assert_eq!(
        session_update_json(AgentClientSessionUpdate::SessionInfoUpdate(
            AgentClientSessionInfoUpdate {
                title: AgentClientMaybeString::default(),
                updated_at: AgentClientMaybeString::default(),
                meta: None,
            },
        ))?,
        json!({
            "sessionUpdate": "session_info_update"
        })
    );
    Ok(())
}

#[test]
fn serializes_config_option_update_with_acp_discriminator() -> serde_json::Result<()> {
    assert_eq!(
        session_update_json(AgentClientSessionUpdate::ConfigOptionUpdate(
            AgentClientConfigOptionUpdate {
                config_options: vec![AgentClientSessionConfigOption {
                    id: "thinking".to_owned(),
                    name: "Thinking".to_owned(),
                    kind: AgentClientSessionConfigKind::Boolean(AgentClientSessionConfigBoolean {
                        current_value: true,
                    },),
                    description: None,
                    category: Some(AgentClientSessionConfigOptionCategory::ThoughtLevel),
                    meta: None,
                }],
                meta: None,
            },
        ))?,
        json!({
            "sessionUpdate": "config_option_update",
            "configOptions": [{
                "id": "thinking",
                "name": "Thinking",
                "type": "boolean",
                "currentValue": true,
                "category": "thought_level"
            }]
        })
    );
    Ok(())
}
