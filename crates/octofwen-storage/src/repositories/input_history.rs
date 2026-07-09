use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::records::input::InputHistoryRecord;
use crate::sqlite::connection::{StorageResult, open_sqlite_database};

pub const MAX_HISTORY_ITEMS: usize = 100;
pub const MAX_HISTORY_TRUNCATION_BATCH: usize = 20;

pub struct InputHistoryRepository {
    history: Vec<String>,
    connection: Connection,
    max_history_items: usize,
}

impl InputHistoryRepository {
    pub fn open(options: InputHistoryOptions) -> StorageResult<Self> {
        let max_history_items = options.max_history_items.unwrap_or(MAX_HISTORY_ITEMS);
        let database_path = options.database_path.unwrap_or_else(default_database_path);
        let connection = open_sqlite_database(database_path)?;
        let history = load_history(&connection, max_history_items)?;

        Ok(Self {
            history,
            connection,
            max_history_items,
        })
    }

    pub fn current_history(&self) -> &[String] {
        &self.history
    }

    pub fn append(&mut self, input: &str) -> StorageResult<()> {
        if input.trim().is_empty() {
            return Ok(());
        }

        self.history.push(input.to_owned());
        self.connection
            .execute("insert into input_history (input) values (?)", [input])?;
        self.truncate_old_entries()?;
        Ok(())
    }

    pub fn records(&self) -> StorageResult<Vec<InputHistoryRecord>> {
        let mut statement = self
            .connection
            .prepare("select id, input from input_history order by id asc")?;
        let rows = statement.query_map([], |row| {
            Ok(InputHistoryRecord {
                id: row.get(0)?,
                input: row.get(1)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn truncate_old_entries(&self) -> StorageResult<()> {
        let limit = sqlite_limit(self.max_history_items);
        self.connection.execute(
            "delete from input_history where id not in (select id from input_history order by id desc limit ?)",
            [limit],
        )?;
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InputHistoryOptions {
    pub database_path: Option<PathBuf>,
    pub max_history_items: Option<usize>,
}

impl InputHistoryOptions {
    pub fn with_database_path(path: impl AsRef<Path>) -> Self {
        Self {
            database_path: Some(path.as_ref().to_path_buf()),
            max_history_items: None,
        }
    }

    #[must_use]
    pub fn with_max_history_items(mut self, max_history_items: usize) -> Self {
        self.max_history_items = Some(max_history_items);
        self
    }
}

pub fn default_database_path() -> PathBuf {
    octofwen_config::paths::default_sqlite_database()
}

fn load_history(connection: &Connection, max_history_items: usize) -> StorageResult<Vec<String>> {
    let limit = sqlite_limit(max_history_items);
    let mut statement =
        connection.prepare("select id, input from input_history order by id asc limit ?")?;
    let rows = statement.query_map([limit], |row| row.get(1))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn sqlite_limit(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}
