pub const AGENT_CLIENT_AGENT_METHODS: &[&str] = &[
    "initialize",
    "authenticate",
    "session/new",
    "session/load",
    "session/prompt",
    "logout",
    "session/set_mode",
];

pub const AGENT_CLIENT_AGENT_NOTIFICATIONS: &[&str] = &["session/cancel"];

pub const AGENT_CLIENT_CLIENT_METHODS: &[&str] = &[
    "session/request_permission",
    "fs/read_text_file",
    "fs/write_text_file",
    "terminal/create",
    "terminal/output",
    "terminal/release",
    "terminal/wait_for_exit",
    "terminal/kill",
];

pub const AGENT_CLIENT_CLIENT_NOTIFICATIONS: &[&str] = &["session/update"];

pub fn is_agent_client_method(value: &str) -> bool {
    AGENT_CLIENT_AGENT_METHODS.contains(&value)
        || AGENT_CLIENT_AGENT_NOTIFICATIONS.contains(&value)
        || AGENT_CLIENT_CLIENT_METHODS.contains(&value)
        || AGENT_CLIENT_CLIENT_NOTIFICATIONS.contains(&value)
}

pub fn is_absolute_agent_client_path(value: &str) -> bool {
    value.starts_with('/')
}

pub const fn is_one_based_line_number(value: u64) -> bool {
    value >= 1
}
