use std::path::{Path, PathBuf};

use crate::sqlite::connection::{StorageError, StorageResult, open_sqlite_database};

pub const DEFAULT_UPDATES_FILE_NAME: &str = "IN-APP-UPDATES.txt";

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct UpdateNotificationsOptions {
    pub updates_path: Option<PathBuf>,
    pub database_path: Option<PathBuf>,
}

impl UpdateNotificationsOptions {
    pub fn with_paths(updates_path: impl AsRef<Path>, database_path: impl AsRef<Path>) -> Self {
        Self {
            updates_path: Some(updates_path.as_ref().to_path_buf()),
            database_path: Some(database_path.as_ref().to_path_buf()),
        }
    }
}

pub fn read_updates(options: &UpdateNotificationsOptions) -> StorageResult<Option<String>> {
    let updates = current_updates(options)?;
    let database_path = options
        .database_path
        .clone()
        .unwrap_or_else(default_database_path);
    let connection = open_sqlite_database(database_path)?;
    let most_recent_seen = connection
        .query_row(
            "select id, \"update\" from shown_update_notifs order by id desc limit 1",
            [],
            |row| row.get::<_, String>(1),
        )
        .optional()?;

    if most_recent_seen.as_deref() == Some(updates.as_str()) {
        Ok(None)
    } else {
        Ok(Some(updates))
    }
}

pub fn mark_updates_seen(options: &UpdateNotificationsOptions) -> StorageResult<()> {
    let update = current_updates(options)?;
    let database_path = options
        .database_path
        .clone()
        .unwrap_or_else(default_database_path);
    let connection = open_sqlite_database(database_path)?;
    connection.execute(
        "insert or ignore into shown_update_notifs (\"update\") values (?)",
        [&update],
    )?;
    Ok(())
}

pub fn default_database_path() -> PathBuf {
    octofwen_config::paths::default_sqlite_database()
}

pub fn default_updates_file_path(package_root: impl AsRef<Path>) -> PathBuf {
    package_root.as_ref().join(DEFAULT_UPDATES_FILE_NAME)
}

fn current_updates(options: &UpdateNotificationsOptions) -> StorageResult<String> {
    let updates_path = options
        .updates_path
        .clone()
        .unwrap_or_else(|| default_updates_file_path("."));
    std::fs::read_to_string(&updates_path).map_err(|source| StorageError::File {
        path: updates_path.display().to_string(),
        source,
    })
}

trait OptionalRow<T> {
    fn optional(self) -> StorageResult<Option<T>>;
}

impl<T> OptionalRow<T> for rusqlite::Result<T> {
    fn optional(self) -> StorageResult<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
}
