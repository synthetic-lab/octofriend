use std::path::{Path, PathBuf};
use std::time::Duration;

use octofwen_transport::docker::DockerTransport;
use octofwen_transport::local::{DirectoryEntry, LocalTransport};
use octofwen_transport::ssh::SshTransport;

pub enum RuntimeToolTransport {
    Local(PathBuf),
    Docker(DockerTransport),
    Ssh(SshTransport),
}

impl RuntimeToolTransport {
    pub fn local(cwd: impl AsRef<Path>) -> Self {
        Self::Local(cwd.as_ref().to_path_buf())
    }

    pub fn docker(container: impl Into<String>, cwd: impl Into<String>) -> Self {
        Self::Docker(DockerTransport::new(container, cwd))
    }

    pub fn ssh(target: impl Into<String>, cwd: impl Into<String>) -> Self {
        Self::Ssh(SshTransport::new(target, cwd))
    }

    pub fn cwd(&self) -> &Path {
        match self {
            Self::Local(cwd) => cwd,
            Self::Docker(transport) => transport.cwd_path(),
            Self::Ssh(transport) => transport.cwd_path(),
        }
    }

    pub fn shell(&self, command: &str, timeout_ms: u64) -> Result<String, String> {
        match self {
            Self::Local(cwd) => LocalTransport::new(cwd)
                .shell(command, Duration::from_millis(timeout_ms))
                .map_err(|error| error.to_string()),
            Self::Docker(transport) => transport
                .shell(command, Duration::from_millis(timeout_ms))
                .map_err(|error| error.to_string()),
            Self::Ssh(transport) => transport
                .shell(command, Duration::from_millis(timeout_ms))
                .map_err(|error| error.to_string()),
        }
    }

    pub fn read_file(&self, file_path: &str) -> Result<String, String> {
        match self {
            Self::Local(cwd) => std::fs::read_to_string(resolve_path(cwd, file_path))
                .map_err(|_| format!("{file_path} couldn't be read")),
            Self::Docker(transport) => transport
                .read_file(file_path)
                .map_err(|_| format!("{file_path} couldn't be read")),
            Self::Ssh(transport) => transport
                .read_file(file_path)
                .map_err(|_| format!("{file_path} couldn't be read")),
        }
    }

    pub fn write_file(&self, file_path: &str, content: &str) -> Result<(), String> {
        match self {
            Self::Local(cwd) => {
                let path = resolve_path(cwd, file_path);
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                std::fs::write(path, content).map_err(|error| error.to_string())
            }
            Self::Docker(transport) => transport
                .write_file(file_path, content)
                .map_err(|error| error.to_string()),
            Self::Ssh(transport) => transport
                .write_file(file_path, content)
                .map_err(|error| error.to_string()),
        }
    }

    pub fn readdir(&self, dir_path: &str) -> Result<Vec<DirectoryEntry>, String> {
        match self {
            Self::Local(cwd) => {
                let entries = std::fs::read_dir(resolve_path(cwd, dir_path))
                    .map_err(|_| format!("No such directory: {dir_path}"))?;
                let mut lines = Vec::new();
                for entry in entries {
                    let entry = entry.map_err(|error| error.to_string())?;
                    let is_directory = entry
                        .file_type()
                        .map(|file_type| file_type.is_dir())
                        .unwrap_or(false);
                    lines.push(DirectoryEntry {
                        entry: entry.file_name().to_string_lossy().to_string(),
                        is_directory,
                    });
                }
                Ok(lines)
            }
            Self::Docker(transport) => transport
                .readdir(dir_path)
                .map_err(|_| format!("No such directory: {dir_path}")),
            Self::Ssh(transport) => transport
                .readdir(dir_path)
                .map_err(|_| format!("No such directory: {dir_path}")),
        }
    }

    pub fn path_exists(&self, file_path: &str) -> bool {
        match self {
            Self::Local(cwd) => resolve_path(cwd, file_path).exists(),
            Self::Docker(transport) => transport.path_exists(file_path),
            Self::Ssh(transport) => transport.path_exists(file_path),
        }
    }
}

fn resolve_path(cwd: &Path, file_path: &str) -> PathBuf {
    let path = Path::new(file_path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}
