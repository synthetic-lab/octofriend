#![expect(
    clippy::expect_used,
    reason = "agentd integration tests assert fixture setup and JSON response shape"
)]
#![expect(
    clippy::unreadable_literal,
    reason = "test JSON mirrors provider context-window fixtures"
)]
#![expect(
    clippy::redundant_clone,
    reason = "test JSON keeps expected model values available for assertions"
)]
#![expect(
    clippy::too_many_lines,
    reason = "integration scenarios keep request and expected JSON together"
)]
#![expect(
    clippy::large_stack_arrays,
    reason = "single test HTTP fixture reads bounded local request data"
)]
use ignore as _;
use json5 as _;
use octofwen_config as _;
use octofwen_core as _;
use octofwen_llm as _;
use octofwen_protocol as _;
use octofwen_storage as _;
use octofwen_tools as _;
use octofwen_transport as _;
use reqwest as _;
use serde as _;
use serde_json as _;

mod agentd {
    mod conversation_history;
    mod input_history;
    mod json_rpc;
    mod skill_discovery;
    mod tool;
    mod transport;
    mod update_notifications;
}
