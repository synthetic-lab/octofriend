use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use octofwen_store::record::conversation::{ConversationHistoryKind, ConversationHistoryRecord};
use octofwen_store::repo::history::{
    ConversationHistoryOptions, ConversationHistoryRepository, default_database_path,
};
use rusqlite::Connection;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn temp_database_path(name: &str) -> PathBuf {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir()
        .join(format!(
            "octofwen-conversation-history-{name}-{}-{id}",
            std::process::id()
        ))
        .join("history.sqlite")
}

fn remove_database_root(database_path: &Path) {
    if let Some(root) = database_path.parent() {
        let _ = std::fs::remove_dir_all(root);
    }
}

fn insert_raw(database_path: &Path, kind: &str, payload: Option<&str>) -> TestResult {
    let connection = Connection::open(database_path)?;
    connection.execute(
        "insert into conversation_history (kind, payload) values (?, ?)",
        (kind, payload),
    )?;
    Ok(())
}

#[test]
fn appends_and_reads_conversation_history_entries_in_order() -> TestResult {
    let database_path = temp_database_path("append");
    let repository = ConversationHistoryRepository::open(
        ConversationHistoryOptions::with_database_path(&database_path),
    )?;

    repository.append_notification("heads up")?;
    repository.append_request_failed()?;
    repository.append_llm_ir(r#"{"role":"user","content":"hello"}"#)?;
    repository.append_compaction_failed()?;

    assert_eq!(
        repository.records()?,
        vec![
            ConversationHistoryRecord {
                id: 1,
                kind: ConversationHistoryKind::Notification,
                payload: Some("heads up".into()),
            },
            ConversationHistoryRecord {
                id: 2,
                kind: ConversationHistoryKind::RequestFailed,
                payload: None,
            },
            ConversationHistoryRecord {
                id: 3,
                kind: ConversationHistoryKind::LlmIr,
                payload: Some(r#"{"role":"user","content":"hello"}"#.into()),
            },
            ConversationHistoryRecord {
                id: 4,
                kind: ConversationHistoryKind::CompactionFailed,
                payload: None,
            },
        ]
    );
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn extracts_only_llm_ir_payloads_from_mixed_history() -> TestResult {
    let database_path = temp_database_path("llm-ir");
    let repository = ConversationHistoryRepository::open(
        ConversationHistoryOptions::with_database_path(&database_path),
    )?;

    repository.append_notification("heads up")?;
    repository.append_llm_ir(r#"{"role":"user","content":"hello"}"#)?;
    repository.append_request_failed()?;
    repository.append_llm_ir(r#"{"role":"assistant","content":"hi"}"#)?;

    assert_eq!(
        repository.llm_ir_payloads()?,
        vec![
            r#"{"role":"user","content":"hello"}"#.to_string(),
            r#"{"role":"assistant","content":"hi"}"#.to_string(),
        ]
    );
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn creates_parent_directories_for_file_backed_databases() -> TestResult {
    let database_path = temp_database_path("parent").join("nested/conversation/history.sqlite");
    let repository = ConversationHistoryRepository::open(
        ConversationHistoryOptions::with_database_path(&database_path),
    )?;

    repository.append_notification("created")?;

    assert_eq!(repository.records()?.len(), 1);
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn invalid_persisted_history_kind_returns_an_error() -> TestResult {
    let database_path = temp_database_path("invalid-kind");
    let repository = ConversationHistoryRepository::open(
        ConversationHistoryOptions::with_database_path(&database_path),
    )?;
    insert_raw(&database_path, "unexpected", Some("payload"))?;

    let error = repository.records().expect_err("invalid kind should fail");

    assert!(
        error
            .to_string()
            .contains("sqlite storage error: Conversion error from type Text"),
        "unexpected error: {error}"
    );
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn default_path_preserves_legacy_octofriend_sqlite_location() {
    let expected = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local/share/octofriend/sqlite.db");

    assert_eq!(default_database_path(), expected);
}
