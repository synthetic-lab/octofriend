use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use octofriend_store::repo::input::{
    InputHistoryOptions, InputHistoryRepository, MAX_HISTORY_ITEMS, MAX_HISTORY_TRUNCATION_BATCH,
    default_database_path,
};
use rusqlite::Connection;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn temp_database_path(name: &str) -> PathBuf {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir()
        .join(format!(
            "octofriend-store-{name}-{}-{id}",
            std::process::id()
        ))
        .join("history.sqlite")
}

fn read_inputs(database_path: &Path) -> TestResult<Vec<String>> {
    let connection = Connection::open(database_path)?;
    let mut statement = connection.prepare("select input from input_history order by id")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn insert_inputs(database_path: &Path, inputs: &[String]) -> TestResult {
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(database_path)?;
    connection.execute_batch(
        "create table if not exists input_history (id integer primary key autoincrement, input text not null)",
    )?;
    for input in inputs {
        connection.execute("insert into input_history (input) values (?)", [input])?;
    }
    Ok(())
}

fn remove_database_root(database_path: &Path) {
    if let Some(root) = database_path.parent() {
        let _ = std::fs::remove_dir_all(root);
    }
}

#[test]
fn loads_empty_history_and_appends_non_empty_items() -> TestResult {
    let database_path = temp_database_path("append");
    let mut repository =
        InputHistoryRepository::open(InputHistoryOptions::with_database_path(&database_path))?;

    assert_eq!(
        repository.current_history(),
        Vec::<String>::new().as_slice()
    );

    repository.append("command 1")?;
    repository.append("command 2")?;

    assert_eq!(repository.current_history(), ["command 1", "command 2"]);
    assert_eq!(read_inputs(&database_path)?, ["command 1", "command 2"]);
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn preserves_original_non_empty_input_text_but_ignores_blank_input() -> TestResult {
    let database_path = temp_database_path("blank");
    let mut repository =
        InputHistoryRepository::open(InputHistoryOptions::with_database_path(&database_path))?;

    for input in ["valid command", "  trimmed  ", "", "   "] {
        repository.append(input)?;
    }

    assert_eq!(
        repository.current_history(),
        ["valid command", "  trimmed  "]
    );
    assert_eq!(
        read_inputs(&database_path)?,
        ["valid command", "  trimmed  "]
    );
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn loads_existing_rows_in_ascending_id_order() -> TestResult {
    let database_path = temp_database_path("existing");
    insert_inputs(&database_path, &["existing 1".into(), "existing 2".into()])?;

    let repository =
        InputHistoryRepository::open(InputHistoryOptions::with_database_path(&database_path))?;

    assert_eq!(repository.current_history(), ["existing 1", "existing 2"]);
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn loads_at_most_the_configured_history_limit() -> TestResult {
    let database_path = temp_database_path("limit");
    let inputs = (1..=MAX_HISTORY_ITEMS + 5)
        .map(|index| format!("existing {index}"))
        .collect::<Vec<_>>();
    insert_inputs(&database_path, &inputs)?;

    let repository =
        InputHistoryRepository::open(InputHistoryOptions::with_database_path(&database_path))?;

    assert_eq!(repository.current_history().len(), MAX_HISTORY_ITEMS);
    assert_eq!(
        repository.current_history().first(),
        Some(&"existing 1".into())
    );
    assert_eq!(
        repository.current_history().last(),
        Some(&format!("existing {MAX_HISTORY_ITEMS}"))
    );
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn truncates_old_persisted_rows_when_history_exceeds_the_configured_limit() -> TestResult {
    let database_path = temp_database_path("truncate");
    let mut repository =
        InputHistoryRepository::open(InputHistoryOptions::with_database_path(&database_path))?;
    let command_count = MAX_HISTORY_ITEMS + MAX_HISTORY_TRUNCATION_BATCH;

    for index in 1..=command_count {
        repository.append(&format!("command {index}"))?;
    }

    let rows = read_inputs(&database_path)?;
    assert_eq!(rows.len(), MAX_HISTORY_ITEMS);
    assert!(rows.contains(&format!("command {command_count}")));
    assert!(!rows.contains(&"command 1".into()));
    assert_eq!(
        rows.first(),
        Some(&format!("command {}", MAX_HISTORY_TRUNCATION_BATCH + 1))
    );
    remove_database_root(&database_path);
    Ok(())
}

#[test]
fn creates_parent_directories_for_file_backed_databases() -> TestResult {
    let database_path = temp_database_path("parent").join("nested/input/history.sqlite");
    let mut repository =
        InputHistoryRepository::open(InputHistoryOptions::with_database_path(&database_path))?;

    repository.append("created")?;

    assert_eq!(read_inputs(&database_path)?, ["created"]);
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
