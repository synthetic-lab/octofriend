pub mod commands;
pub mod env;
pub mod keys;

pub use commands::{
    AUTH_COMMAND_MAX_OUTPUT_BYTES, AUTH_COMMAND_TIMEOUT_MS, CommandAuth, parse_command_stdout,
    validate_command_auth,
};
pub use env::{AuthError, EnvAuth, KeyResult, resolve_env_auth, resolve_env_auth_from};
pub use keys::{
    ApiKeyMap, SYNTHETIC_BASE_URLS, api_key_map_from_value, default_env_var, is_synthetic_base_url,
    parse_api_key_map, provider_env_var_for_base_url,
};
