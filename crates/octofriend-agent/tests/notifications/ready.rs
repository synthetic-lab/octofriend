use octofriend_agent::notifications::{
    NotificationHistoryItem, ReadyForInputConfig, ReadyForInputState, ready_for_input_schedule,
};

#[test]
fn notify_once_schedules_immediately_and_resets_flag() {
    let mut state = ReadyForInputState {
        session_auto_notify: false,
        notify_once: true,
    };
    let decision = ready_for_input_schedule(&mut state, &ReadyForInputConfig::default());

    assert_eq!(decision, Some(0));
    assert!(!state.notify_once);
}

#[test]
fn always_notify_or_session_auto_notify_schedules_configured_timeout() {
    let mut always_state = ReadyForInputState::default();
    let always = ReadyForInputConfig {
        always_notify: true,
        notify_timeout_ms: Some(2500),
    };
    assert_eq!(
        ready_for_input_schedule(&mut always_state, &always),
        Some(2500)
    );

    let mut session_state = ReadyForInputState {
        session_auto_notify: true,
        notify_once: false,
    };
    assert_eq!(
        ready_for_input_schedule(&mut session_state, &ReadyForInputConfig::default()),
        Some(10_000)
    );
}

#[test]
fn ready_notification_is_not_scheduled_without_an_enabled_trigger() {
    let mut state = ReadyForInputState::default();

    assert_eq!(
        ready_for_input_schedule(&mut state, &ReadyForInputConfig::default()),
        None
    );
}

#[test]
fn notification_history_items_preserve_notification_content() {
    assert_eq!(
        NotificationHistoryItem::new("done"),
        NotificationHistoryItem {
            kind: "notification".into(),
            content: "done".into(),
        }
    );
}
