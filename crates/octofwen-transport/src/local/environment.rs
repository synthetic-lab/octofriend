use std::time::Duration;

use crate::local::LocalTransport;
use crate::local::filesystem::TransportResult;

pub fn get_env_var(
    _transport: &LocalTransport,
    env_var_name: &str,
    _timeout: Duration,
) -> TransportResult<String> {
    Ok(std::env::var(env_var_name).unwrap_or_default())
}
