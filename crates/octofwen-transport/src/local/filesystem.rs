use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectoryEntry {
    pub entry: String,
    pub is_directory: bool,
}

#[derive(Debug)]
pub enum TransportError {
    Io {
        operation: &'static str,
        path: String,
        source: std::io::Error,
    },
    CommandFailed {
        message: String,
        exit_code: Option<i32>,
    },
    Aborted,
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io {
                operation,
                path,
                source,
            } => {
                write!(formatter, "Could not {operation} {path}: {source}")
            }
            Self::CommandFailed { message, .. } => formatter.write_str(message),
            Self::Aborted => formatter.write_str("Aborted"),
        }
    }
}

impl std::error::Error for TransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::CommandFailed { .. } | Self::Aborted => None,
        }
    }
}

pub type TransportResult<T> = Result<T, TransportError>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalTransport {
    cwd: PathBuf,
}

impl LocalTransport {
    pub fn new(cwd: impl AsRef<Path>) -> Self {
        Self {
            cwd: cwd.as_ref().to_path_buf(),
        }
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    pub fn write_file(&self, file: impl AsRef<Path>, contents: &str) -> TransportResult<()> {
        let file = file.as_ref();
        fs::write(file, contents).map_err(|source| TransportError::Io {
            operation: "write file",
            path: file.display().to_string(),
            source,
        })
    }

    pub fn read_file(&self, file: impl AsRef<Path>) -> TransportResult<String> {
        let file = file.as_ref();
        fs::read_to_string(file).map_err(|source| TransportError::Io {
            operation: "read file",
            path: file.display().to_string(),
            source,
        })
    }

    pub fn mod_time(&self, file: impl AsRef<Path>) -> TransportResult<f64> {
        let file = file.as_ref();
        let modified = fs::metadata(file)
            .and_then(|metadata| metadata.modified())
            .map_err(|source| TransportError::Io {
                operation: "get modified time for",
                path: file.display().to_string(),
                source,
            })?;
        let duration = modified.duration_since(UNIX_EPOCH).unwrap_or_default();
        Ok(duration.as_secs_f64() * 1000.0)
    }

    pub fn resolve_path(&self, file: impl AsRef<Path>) -> PathBuf {
        let file = file.as_ref();
        fs::canonicalize(file).unwrap_or_else(|_| self.cwd.join(file))
    }

    pub fn mkdir(&self, dirpath: impl AsRef<Path>) -> TransportResult<()> {
        let dirpath = dirpath.as_ref();
        fs::create_dir_all(dirpath).map_err(|source| TransportError::Io {
            operation: "create directory",
            path: dirpath.display().to_string(),
            source,
        })
    }

    pub fn readdir(&self, dirpath: impl AsRef<Path>) -> TransportResult<Vec<DirectoryEntry>> {
        let dirpath = dirpath.as_ref();
        let entries = fs::read_dir(dirpath).map_err(|source| TransportError::Io {
            operation: "read directory",
            path: dirpath.display().to_string(),
            source,
        })?;
        let mut result = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|source| TransportError::Io {
                operation: "read directory entry",
                path: dirpath.display().to_string(),
                source,
            })?;
            let entry_path = entry.path();
            let is_directory = fs::metadata(&entry_path)
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false);
            result.push(DirectoryEntry {
                entry: entry.file_name().to_string_lossy().into_owned(),
                is_directory,
            });
        }
        Ok(result)
    }

    pub fn path_exists(&self, file: impl AsRef<Path>) -> bool {
        self.mod_time(file).is_ok()
    }

    pub fn is_directory(&self, file: impl AsRef<Path>) -> bool {
        fs::metadata(file)
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
    }
}
