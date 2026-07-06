use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::docker::paths::{shell_quote, shell_quote_path};
use crate::local::filesystem::{DirectoryEntry, TransportError, TransportResult};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DockerTransport {
    container: String,
    cwd: PathBuf,
    command: PathBuf,
}

impl DockerTransport {
    pub fn new(container: impl Into<String>, cwd: impl Into<String>) -> Self {
        Self::with_command(container, cwd, PathBuf::from("docker"))
    }

    fn with_command(
        container: impl Into<String>,
        cwd: impl Into<String>,
        command: impl Into<PathBuf>,
    ) -> Self {
        Self {
            container: container.into(),
            cwd: PathBuf::from(cwd.into()),
            command: command.into(),
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
        let parent = Path::new(file)
            .parent()
            .and_then(Path::to_str)
            .filter(|parent| !parent.is_empty());
        let mkdir = parent
            .map(|parent| format!("mkdir -p -- {} && ", shell_quote(parent)))
            .unwrap_or_default();
        self.exec_shell(
            &format!("{mkdir}cat > {}", shell_quote(file)),
            Duration::from_secs(10),
            Some(contents),
        )?;
        Ok(())
    }

    pub fn readdir(&self, dir: &str) -> TransportResult<Vec<DirectoryEntry>> {
        let script = format!(
            "for entry in {0}/* {0}/.[!.]* {0}/..?*; do [ -e \"$entry\" ] || continue; name=$(basename \"$entry\"); if [ -d \"$entry\" ]; then printf 'd\\t%s\\n' \"$name\"; else printf 'f\\t%s\\n' \"$name\"; fi; done",
            shell_quote(dir)
        );
        let output = self.shell(&script, Duration::from_secs(10))?;
        Ok(output
            .lines()
            .filter_map(|line| {
                let (kind, entry) = line.split_once('\t')?;
                Some(DirectoryEntry {
                    entry: entry.to_string(),
                    is_directory: kind == "d",
                })
            })
            .collect())
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
        let mut child = Command::new(&self.command)
            .arg("exec")
            .arg("-i")
            .arg(&self.container)
            .arg("/bin/sh")
            .arg("-c")
            .arg(format!("cd {} && {command}", shell_quote_path(&self.cwd)))
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

fn read_output_in_thread<T>(mut stream: T) -> thread::JoinHandle<String>
where
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = String::new();
        let _ = stream.read_to_string(&mut output);
        output
    })
}

fn join_output(
    stdout: Option<thread::JoinHandle<String>>,
    stderr: Option<thread::JoinHandle<String>>,
) -> String {
    let mut output = String::new();
    if let Some(stdout) = stdout {
        output.push_str(&stdout.join().unwrap_or_default());
    }
    if let Some(stderr) = stderr {
        output.push_str(&stderr.join().unwrap_or_default());
    }
    output
}
