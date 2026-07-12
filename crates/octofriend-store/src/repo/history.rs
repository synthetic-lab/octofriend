use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};

use crate::record::conversation::{
    ConversationHistoryKind, ConversationHistoryRecord, ConversationRevision,
    ConversationSessionMetadata,
};
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

    pub fn create_session(
        &self,
        session_id: &str,
        cwd: &str,
        launch_json: &str,
        timestamp: i64,
    ) -> StorageResult<()> {
        self.connection.execute(
            "insert into conversation_session (
                singleton, session_id, cwd, launch_json, created_at, updated_at
             ) values (1, ?, ?, ?, ?, ?)",
            (session_id, cwd, launch_json, timestamp, timestamp),
        )?;
        Ok(())
    }

    pub fn session_metadata(&self) -> StorageResult<Option<ConversationSessionMetadata>> {
        let mut statement = self.connection.prepare(
            "select session_id, cwd, launch_json, created_at, updated_at
             from conversation_session where singleton = 1",
        )?;
        let mut rows = statement.query([])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(ConversationSessionMetadata {
            session_id: row.get(0)?,
            cwd: row.get(1)?,
            launch_json: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        }))
    }

    pub fn replace_records(
        &self,
        records: &[ConversationHistoryRecord],
        timestamp: i64,
    ) -> StorageResult<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("delete from conversation_history", [])?;
        {
            let mut statement = transaction
                .prepare("insert into conversation_history (kind, payload) values (?, ?)")?;
            for record in records {
                statement.execute((record.kind.as_str(), record.payload.as_deref()))?;
            }
        }
        transaction.execute(
            "update conversation_session set updated_at = ? where singleton = 1",
            [timestamp],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn append_revision(
        &self,
        records: &[ConversationHistoryRecord],
        parent_revision_id: Option<i64>,
        timestamp: i64,
    ) -> StorageResult<i64> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "insert into conversation_revision (parent_id, created_at) values (?, ?)",
            (parent_revision_id, timestamp),
        )?;
        let revision_id = transaction.last_insert_rowid();
        {
            let mut statement = transaction.prepare(
                "insert into conversation_revision_record
                 (revision_id, position, kind, payload) values (?, ?, ?, ?)",
            )?;
            for (position, record) in records.iter().enumerate() {
                statement.execute((
                    revision_id,
                    i64::try_from(position).unwrap_or(i64::MAX),
                    record.kind.as_str(),
                    record.payload.as_deref(),
                ))?;
            }
        }
        transaction.execute(
            "update conversation_session set updated_at = ? where singleton = 1",
            [timestamp],
        )?;
        transaction.commit()?;
        Ok(revision_id)
    }

    pub fn latest_revision_records(
        &self,
    ) -> StorageResult<(Option<i64>, Vec<ConversationHistoryRecord>)> {
        let revision_id = self
            .connection
            .query_row(
                "select id from conversation_revision
                 order by created_at desc, id desc limit 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(revision_id) = revision_id else {
            return Ok((None, self.records()?));
        };
        let mut statement = self.connection.prepare(
            "select position, kind, payload from conversation_revision_record
             where revision_id = ? order by position asc",
        )?;
        let rows = statement.query_map([revision_id], conversation_history_row)?;
        let records = rows.collect::<Result<Vec<_>, _>>()?;
        Ok((Some(revision_id), records))
    }

    pub fn revisions(&self) -> StorageResult<Vec<ConversationRevision>> {
        let mut statement = self.connection.prepare(
            "select id, parent_id, created_at from conversation_revision order by id asc",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(ConversationRevision {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn records(&self) -> StorageResult<Vec<ConversationHistoryRecord>> {
        let mut statement = self
            .connection
            .prepare("select id, kind, payload from conversation_history order by id asc")?;
        let rows = statement.query_map([], conversation_history_row)?;

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

fn conversation_history_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ConversationHistoryRecord> {
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
