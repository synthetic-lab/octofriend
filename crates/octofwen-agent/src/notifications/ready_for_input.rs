pub const DEFAULT_NOTIFY_TIMEOUT_MS: u64 = 10_000;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ReadyForInputState {
    pub session_auto_notify: bool,
    pub notify_once: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ReadyForInputConfig {
    pub always_notify: bool,
    pub notify_timeout_ms: Option<u64>,
}

pub fn ready_for_input_schedule(
    state: &mut ReadyForInputState,
    config: &ReadyForInputConfig,
) -> Option<u64> {
    let notify_once = state.notify_once;
    if notify_once {
        state.notify_once = false;
        return Some(0);
    }
    if config.always_notify || state.session_auto_notify {
        return Some(
            config
                .notify_timeout_ms
                .unwrap_or(DEFAULT_NOTIFY_TIMEOUT_MS),
        );
    }
    None
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotificationHistoryItem {
    pub kind: String,
    pub content: String,
}

impl NotificationHistoryItem {
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            kind: "notification".into(),
            content: content.into(),
        }
    }
}
