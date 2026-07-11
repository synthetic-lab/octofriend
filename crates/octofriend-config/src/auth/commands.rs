use crate::auth::env::KeyResult;

pub const AUTH_COMMAND_TIMEOUT_MS: u64 = 15_000;
pub const AUTH_COMMAND_MAX_OUTPUT_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandAuth {
    pub command: Vec<String>,
}

impl CommandAuth {
    pub fn new(command: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            command: command.into_iter().map(Into::into).collect(),
        }
    }

    pub fn cache_key(&self) -> String {
        self.command.join("\0")
    }
}

pub fn validate_command_auth(auth: &CommandAuth) -> KeyResult {
    if auth.command.first().is_none_or(String::is_empty) {
        KeyResult::invalid("Auth command is empty")
    } else {
        KeyResult::ok(auth.cache_key())
    }
}

pub fn parse_command_stdout(stdout: &str) -> KeyResult {
    let key = stdout.trim();
    if key.is_empty() {
        KeyResult::invalid("Auth command returned empty output")
    } else {
        KeyResult::ok(key)
    }
}
