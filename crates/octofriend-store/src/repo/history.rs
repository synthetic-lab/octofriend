use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::record::conversation::{ConversationHistoryKind, ConversationHistoryRecord};
use crate::sqlite::connection::{StorageError, StorageResult, open_sqlite_database};

pub struct ConversationHistoryRepository {
    connection: Connection,
}

impl ConversationHistoryRepository {
    pub fn open(options: ConversationHistoryOptions) -> StorageResult<Self> {
        let database_path = options.database_path.unwrap_or_else(default_database_path);
        let connection = open_sqlite_database(database_path)?;
        Ok(Self { connection })
    }

    pub fn append_llm_ir(&self, payload: &str) -> StorageResult<()> {
        self.append(ConversationHistoryKind::LlmIr, Some(payload))
    }

    pub fn append_request_failed(&self) -> StorageResult<()> {
        self.append(ConversationHistoryKind::RequestFailed, None)
    }

    pub fn append_compaction_failed(&self) -> StorageResult<()> {
        self.append(ConversationHistoryKind::CompactionFailed, None)
    }

    pub fn append_notification(&self, content: &str) -> StorageResult<()> {
        self.append(ConversationHistoryKind::Notification, Some(content))
    }

    pub fn records(&self) -> StorageResult<Vec<ConversationHistoryRecord>> {
        let mut statement = self
            .connection
            .prepare("select id, kind, payload from conversation_history order by id asc")?;
        let rows = statement.query_map([], |row| {
            let kind_text: String = row.get(1)?;
            let kind = ConversationHistoryKind::parse(&kind_text).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    Box::new(InvalidConversationHistoryKind(kind_text.clone())),
                )
            })?;

            Ok(ConversationHistoryRecord {
                id: row.get(0)?,
                kind,
                payload: row.get(2)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn llm_ir_payloads(&self) -> StorageResult<Vec<String>> {
        let mut statement = self.connection.prepare(
            "select payload from conversation_history where kind = ? and payload is not null order by id asc",
        )?;
        let rows =
            statement.query_map([ConversationHistoryKind::LlmIr.as_str()], |row| row.get(0))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn append(&self, kind: ConversationHistoryKind, payload: Option<&str>) -> StorageResult<()> {
        self.connection.execute(
            "insert into conversation_history (kind, payload) values (?, ?)",
            (kind.as_str(), payload),
        )?;
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ConversationHistoryOptions {
    pub database_path: Option<PathBuf>,
}

impl ConversationHistoryOptions {
    pub fn with_database_path(path: impl AsRef<Path>) -> Self {
        Self {
            database_path: Some(path.as_ref().to_path_buf()),
        }
    }
}

pub fn default_database_path() -> PathBuf {
    octofriend_config::paths::default_sqlite_database()
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct InvalidConversationHistoryKind(String);

impl std::fmt::Display for InvalidConversationHistoryKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "invalid conversation history kind: {}", self.0)
    }
}

impl std::error::Error for InvalidConversationHistoryKind {}

impl From<InvalidConversationHistoryKind> for StorageError {
    fn from(error: InvalidConversationHistoryKind) -> Self {
        Self::Sqlite(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
    }
}
