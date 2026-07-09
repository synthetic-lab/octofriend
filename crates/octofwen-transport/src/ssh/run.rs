use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::local::filesystem::{TransportError, TransportResult};
use crate::process_output::{join_output, read_output_in_thread};
use crate::remote_files::{readdir_with_shell, write_file_with_shell};
use crate::shell::{shell_quote, shell_quote_path};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SshTransport {
    target: String,
    cwd: PathBuf,
    command: PathBuf,
}

impl SshTransport {
    pub fn new(target: impl Into<String>, cwd: impl Into<String>) -> Self {
        Self::with_command(
            target.into(),
            PathBuf::from(cwd.into()),
            PathBuf::from("ssh"),
        )
    }

    fn with_command(target: String, cwd: PathBuf, command: PathBuf) -> Self {
        Self {
            target,
            cwd,
            command,
        }
    }

    pub fn cwd_path(&self) -> &Path {
        &self.cwd
    }

    pub fn shell(&self, command: &str, timeout: Duration) -> TransportResult<String> {
        self.exec_shell(command, timeout, None)
    }

    pub fn read_file(&self, file: &str) -> TransportResult<String> {
        self.shell(
            &format!("cat -- {}", shell_quote(file)),
            Duration::from_secs(10),
        )
    }

    pub fn write_file(&self, file: &str, contents: &str) -> TransportResult<()> {
        write_file_with_shell(file, contents, |command, timeout, stdin_contents| {
            self.exec_shell(command, timeout, stdin_contents)
        })
    }

    pub fn readdir(
        &self,
        dir: &str,
    ) -> TransportResult<Vec<crate::local::filesystem::DirectoryEntry>> {
        readdir_with_shell(dir, |command, timeout| self.shell(command, timeout))
    }

    pub fn path_exists(&self, file: &str) -> bool {
        self.shell(
            &format!("test -e -- {}", shell_quote(file)),
            Duration::from_secs(10),
        )
        .is_ok()
    }

    fn exec_shell(
        &self,
        command: &str,
        timeout: Duration,
        stdin_contents: Option<&str>,
    ) -> TransportResult<String> {
        let remote_command = format!("cd {} && {command}", shell_quote_path(&self.cwd));
        let mut child = Command::new(&self.command)
            .arg(&self.target)
            .arg(remote_command)
            .stdin(if stdin_contents.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|source| TransportError::CommandFailed {
                message: format!("Command failed: {source}"),
                exit_code: None,
            })?;

        if let (Some(contents), Some(mut stdin)) = (stdin_contents, child.stdin.take()) {
            stdin.write_all(contents.as_bytes()).map_err(|source| {
                TransportError::CommandFailed {
                    message: format!("Command failed: {source}"),
                    exit_code: None,
                }
            })?;
        }

        let stdout = child.stdout.take().map(read_output_in_thread);
        let stderr = child.stderr.take().map(read_output_in_thread);
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
                let output = join_output(stdout, stderr);
                return Err(TransportError::CommandFailed {
                    message: format!("Command timed out.\noutput: {output}"),
                    exit_code: None,
                });
            }
            thread::sleep(Duration::from_millis(10));
        };

        let output = join_output(stdout, stderr);
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
