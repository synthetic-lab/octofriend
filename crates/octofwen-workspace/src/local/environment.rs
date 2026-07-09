use std::time::Duration;

use crate::local::LocalTransport;
use crate::local::filesystem::TransportResult;

pub fn get_env_var(
    transport: &LocalTransport,
    env_var_name: &str,
    timeout: Duration,
) -> TransportResult<String> {
    let _ = transport.cwd();
    let _ = timeout;
    Ok(std::env::var(env_var_name).unwrap_or_default())
}
