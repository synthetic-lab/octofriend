pub const AGENT_TO_AGENT_TRANSPORTS: &[&str] = &["jsonrpc-http", "sse"];
pub const AGENT_TO_AGENT_JSON_RPC_METHODS: &[&str] = &[
    "SendMessage",
    "SendStreamingMessage",
    "GetTask",
    "ListTasks",
    "CancelTask",
    "SubscribeToTask",
    "CreateTaskPushNotificationConfig",
    "GetTaskPushNotificationConfig",
    "ListTaskPushNotificationConfigs",
    "DeleteTaskPushNotificationConfig",
    "GetExtendedAgentCard",
];

pub fn is_agent_to_agent_transport(value: &str) -> bool {
    AGENT_TO_AGENT_TRANSPORTS.contains(&value)
}

pub fn is_agent_to_agent_json_rpc_method(value: &str) -> bool {
    AGENT_TO_AGENT_JSON_RPC_METHODS.contains(&value)
}
