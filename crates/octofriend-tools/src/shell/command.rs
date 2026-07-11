pub const USER_ABORTED_ERROR_MESSAGE: &str = "User aborted";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShellCommand {
    pub cmd: String,
    pub timeout_ms: u64,
}

impl ShellCommand {
    pub fn new(cmd: impl Into<String>, timeout_ms: u64) -> Result<Self, String> {
        let cmd = cmd.into();
        if cmd.trim().is_empty() {
            return Err("shell command must not be empty".into());
        }
        if timeout_ms == 0 {
            return Err("shell timeout must be a positive integer".into());
        }
        Ok(Self { cmd, timeout_ms })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShellOutput {
    pub content: String,
}

pub fn shell_output_text(content: impl Into<String>) -> ShellOutput {
    ShellOutput {
        content: content.into(),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandFailed {
    pub message: String,
    pub exit_code: i32,
}

impl CommandFailed {
    pub fn new(message: impl Into<String>, exit_code: i32) -> Self {
        Self {
            message: message.into(),
            exit_code,
        }
    }
}

pub fn user_aborted_error() -> String {
    USER_ABORTED_ERROR_MESSAGE.into()
}

pub fn command_failed_error(error: &CommandFailed) -> String {
    error.message.clone()
}
