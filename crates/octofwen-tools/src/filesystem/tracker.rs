use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FileTracker {
    read_timestamps: BTreeMap<PathBuf, u64>,
}

impl FileTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_file_read_timestamp(&mut self, file_path: impl Into<PathBuf>, modified: u64) {
        self.read_timestamps.insert(file_path.into(), modified);
    }

    pub fn is_outdated(
        &self,
        file_path: impl AsRef<Path>,
        current_modified: Result<u64, String>,
    ) -> bool {
        let Some(last_read_time) = self.read_timestamps.get(file_path.as_ref()) else {
            return false;
        };
        match current_modified {
            Ok(current_modified) => current_modified > *last_read_time,
            Err(_) => false,
        }
    }

    pub fn can_create(&self, current_modified: Result<u64, String>) -> bool {
        current_modified.is_err()
    }

    pub fn assert_can_create(
        &self,
        current_modified: Result<u64, String>,
    ) -> Result<(), FileExistsError> {
        if self.can_create(current_modified) {
            Ok(())
        } else {
            Err(FileExistsError::new("File already exists"))
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileExistsError {
    message: String,
}

impl FileExistsError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for FileExistsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for FileExistsError {}
