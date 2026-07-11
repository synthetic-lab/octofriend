use std::path::PathBuf;

use octofriend_config::paths::{
    data_dir, default_data_dir, default_sqlite_database, sqlite_database,
};

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[test]
fn preserves_legacy_octofriend_data_and_sqlite_paths() {
    assert_eq!(
        data_dir("/home/alice"),
        PathBuf::from("/home/alice/.local/share/octofriend")
    );
    assert_eq!(
        sqlite_database("/home/alice"),
        PathBuf::from("/home/alice/.local/share/octofriend/sqlite.db")
    );
}

#[test]
fn default_data_paths_are_home_relative() {
    let home = home_dir();

    assert_eq!(default_data_dir(), home.join(".local/share/octofriend"));
    assert_eq!(
        default_sqlite_database(),
        home.join(".local/share/octofriend/sqlite.db")
    );
}
