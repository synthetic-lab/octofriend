use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::local::filesystem::{DirectoryEntry, TransportError, TransportResult};
use crate::shell::{shell_quote, shell_quote_path};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SshTransport {
    target: String,
    cwd: PathBuf,
    command: PathBuf,
}

impl SshTransport {
    pub fn new(target: impl Into<String>, cwd: impl Into<String>) -> Self {
        Self::with_command(target, cwd, PathBuf::from("ssh"))
    }

    fn with_command(
        target: impl Into<String>,
        cwd: impl Into<String>,
        command: impl Into<PathBuf>,
    ) -> Self {
        Self {
            target: target.into(),
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::SystemTime;

    use super::SshTransport;

    #[cfg(unix)]
    #[test]
    fn ssh_transport_shells_through_ssh_command_with_target_and_cwd() {
        let root = std::env::temp_dir().join(format!(
            "octofwen-ssh-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("temp root");
        let fake_ssh = root.join("ssh");
        let log = root.join("ssh.log");
        let remote_cwd = root.join("work/project");
        fs::create_dir_all(&remote_cwd).expect("remote cwd");
        fs::write(remote_cwd.join("marker.txt"), "remote-output").expect("marker");
        fs::write(
            &fake_ssh,
            format!(
                "#!/bin/sh\nprintf 'target=%s command=%s\\n' \"$1\" \"$2\" >> '{}'\nshift\n/bin/sh -c \"$1\"\n",
                log.display()
            ),
        )
        .expect("fake ssh");
        make_executable(&fake_ssh);

        let transport =
            SshTransport::with_command("user@example.test", remote_cwd.to_string_lossy(), fake_ssh);
        let output = transport
            .shell("pwd && cat marker.txt", std::time::Duration::from_secs(5))
            .expect("ssh shell should run");
        assert!(output.contains(&remote_cwd.display().to_string()));
        assert!(output.contains("remote-output"));
        let logged = fs::read_to_string(log).expect("ssh log");
        assert!(logged.contains("target=user@example.test"));
        assert!(logged.contains("pwd && cat marker.txt"));

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    fn make_executable(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("permissions");
    }
}
