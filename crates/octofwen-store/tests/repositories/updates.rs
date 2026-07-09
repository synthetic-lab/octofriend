use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use octofwen_store::repo::updates::{
    UpdateNotificationsOptions, default_database_path, default_updates_file_path,
    mark_updates_seen, read_updates,
};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn fixture(update_text: &str) -> std::io::Result<(PathBuf, PathBuf)> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let directory = std::env::temp_dir().join(format!(
        "octofwen-update-notifications-{}-{id}",
        std::process::id()
    ));
    std::fs::create_dir_all(&directory)?;
    let updates_path = directory.join("IN-APP-UPDATES.txt");
    let database_path = directory.join("sqlite.db");
    std::fs::write(&updates_path, update_text)?;
    Ok((updates_path, database_path))
}

fn options(updates_path: &Path, database_path: &Path) -> UpdateNotificationsOptions {
    UpdateNotificationsOptions::with_paths(updates_path, database_path)
}

fn remove_fixture(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::remove_dir_all(parent);
    }
}

#[test]
fn read_updates_returns_current_update_text_before_it_has_been_marked_seen() -> TestResult {
    let (updates_path, database_path) = fixture("New Octo update\n")?;
    let options = options(&updates_path, &database_path);

    let updates = read_updates(&options)?;

    assert_eq!(updates, Some("New Octo update\n".into()));
    remove_fixture(&database_path);
    Ok(())
}

#[test]
fn read_updates_returns_none_when_current_update_is_the_most_recent_seen_update() -> TestResult {
    let (updates_path, database_path) = fixture("Already seen\n")?;
    let options = options(&updates_path, &database_path);

    mark_updates_seen(&options)?;
    let updates = read_updates(&options)?;

    assert_eq!(updates, None);
    remove_fixture(&database_path);
    Ok(())
}

#[test]
fn read_updates_returns_changed_update_text_after_an_older_update_was_marked_seen() -> TestResult {
    let (updates_path, database_path) = fixture("First update\n")?;
    let options = options(&updates_path, &database_path);
    mark_updates_seen(&options)?;
    std::fs::write(&updates_path, "Second update\n")?;

    let updates = read_updates(&options)?;

    assert_eq!(updates, Some("Second update\n".into()));
    remove_fixture(&database_path);
    Ok(())
}

#[test]
fn mark_updates_seen_is_idempotent_for_the_same_update_text() -> TestResult {
    let (updates_path, database_path) = fixture("Duplicate update\n")?;
    let options = options(&updates_path, &database_path);

    mark_updates_seen(&options)?;
    mark_updates_seen(&options)?;
    let updates = read_updates(&options)?;

    assert_eq!(updates, None);
    remove_fixture(&database_path);
    Ok(())
}

#[test]
fn default_paths_preserve_legacy_octofriend_storage_location_and_update_file_name() {
    let expected_database = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local/share/octofriend/sqlite.db");

    assert_eq!(default_database_path(), expected_database);
    assert_eq!(
        default_updates_file_path("/tmp/package-root"),
        PathBuf::from("/tmp/package-root/IN-APP-UPDATES.txt")
    );
}
