use octofriend_tools::shell::{
    CommandFailed, ShellCommand, ShellOutput, USER_ABORTED_ERROR_MESSAGE, command_failed_error,
    shell_output_text, user_aborted_error,
};

#[test]
fn shell_command_requires_a_command_and_positive_timeout() {
    assert_eq!(
        ShellCommand::new("pwd", 1000),
        Ok(ShellCommand {
            cmd: "pwd".into(),
            timeout_ms: 1000,
        })
    );
    assert_eq!(
        ShellCommand::new("", 1000),
        Err("shell command must not be empty".into())
    );
    assert_eq!(
        ShellCommand::new("pwd", 0),
        Err("shell timeout must be a positive integer".into())
    );
}

#[test]
fn wraps_successful_shell_output_as_text_content() {
    assert_eq!(
        shell_output_text("command output"),
        ShellOutput {
            content: "command output".into(),
        }
    );
}

#[test]
fn maps_abort_and_command_failures_to_user_facing_errors() {
    assert_eq!(USER_ABORTED_ERROR_MESSAGE, "User aborted");
    assert_eq!(user_aborted_error(), "User aborted");
    assert_eq!(
        command_failed_error(&CommandFailed::new("no matches", 1)),
        "no matches"
    );
}
