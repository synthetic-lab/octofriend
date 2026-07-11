use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::local::LocalTransport;
use crate::local::filesystem::{TransportError, TransportResult};

impl LocalTransport {
    pub fn shell(&self, command: &str, timeout: Duration) -> TransportResult<String> {
        let (shell, shell_arg) = platform_shell();
        let mut child = Command::new(shell)
            .arg(shell_arg)
            .arg(command)
            .current_dir(self.cwd())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|source| TransportError::CommandFailed {
                message: format!("Command failed: {source}"),
                exit_code: None,
            })?;

        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let start = Instant::now();
        let status = loop {
            if let Some(status) =
                child
                    .try_wait()
                    .map_err(|source| TransportError::CommandFailed {
                        message: format!("Command failed: {source}"),
                        exit_code: None,
                    })?
            {
                break status;
            }
            if start.elapsed() >= timeout {
                let _ = child.kill();
                let _ = child.wait();
                let output = read_output(&mut stdout, &mut stderr);
                return Err(TransportError::CommandFailed {
                    message: format!("Command timed out.\noutput: {output}"),
                    exit_code: None,
                });
            }
            thread::sleep(Duration::from_millis(10));
        };

        let output = read_output(&mut stdout, &mut stderr);
        if status.success() {
            Ok(output)
        } else {
            Err(TransportError::CommandFailed {
                message: format!(
                    "Command exited with code: {}\noutput: {output}",
                    status.code().unwrap_or(-1)
                ),
                exit_code: status.code(),
            })
        }
    }
}

fn read_output(
    stdout: &mut Option<std::process::ChildStdout>,
    stderr: &mut Option<std::process::ChildStderr>,
) -> String {
    let mut output = String::new();
    if let Some(stdout) = stdout {
        let _ = stdout.read_to_string(&mut output);
    }
    if let Some(stderr) = stderr {
        let _ = stderr.read_to_string(&mut output);
    }
    output
}

#[cfg(windows)]
fn platform_shell() -> (String, &'static str) {
    (
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
        "/C",
    )
}

#[cfg(not(windows))]
fn platform_shell() -> (String, &'static str) {
    (
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
        "-c",
    )
}
