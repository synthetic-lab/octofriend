use serde as _;
use serde_json as _;

#[path = "acp/agent_client.rs"]
mod agent_client;
#[path = "a2a/agent_to_agent.rs"]
mod agent_to_agent;
#[path = "json_rpc/json_rpc.rs"]
mod json_rpc;
