use std::fmt;
use std::path::Path;

use rusqlite::Connection;

use crate::sqlite::migrations::{
    CONVERSATION_HISTORY_SCHEMA, INPUT_HISTORY_SCHEMA, UPDATE_NOTIFICATIONS_SCHEMA,
};

#[derive(Debug)]
pub enum StorageError {
    Directory {
        path: String,
        source: std::io::Error,
    },
    File {
        path: String,
        source: std::io::Error,
    },
    Sqlite(rusqlite::Error),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Directory { path, source } => {
                write!(f, "failed to create storage directory {path}: {source}")
            }
            Self::File { path, source } => {
                write!(f, "failed to read storage file {path}: {source}")
            }
            Self::Sqlite(source) => write!(f, "sqlite storage error: {source}"),
        }
    }
}

impl std::error::Error for StorageError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Directory { source, .. } | Self::File { source, .. } => Some(source),
            Self::Sqlite(source) => Some(source),
        }
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(source: rusqlite::Error) -> Self {
        Self::Sqlite(source)
    }
}

pub type StorageResult<T> = Result<T, StorageError>;

pub fn open_sqlite_database(path: impl AsRef<Path>) -> StorageResult<Connection> {
    let path = path.as_ref();
    if path != Path::new(":memory:") {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|source| StorageError::Directory {
                path: parent.display().to_string(),
                source,
            })?;
        }
    }

    let connection = Connection::open(path)?;
    connection.execute_batch(INPUT_HISTORY_SCHEMA)?;
    connection.execute_batch(UPDATE_NOTIFICATIONS_SCHEMA)?;
    connection.execute_batch(CONVERSATION_HISTORY_SCHEMA)?;
    Ok(connection)
}
