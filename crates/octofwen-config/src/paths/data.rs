use env as safe_env;
use std::path::{Path, PathBuf};

pub const DATA_DIRECTORY: &str = ".local/share/octofriend";
pub const SQLITE_DATABASE_FILE: &str = "sqlite.db";

pub fn data_dir(home: impl AsRef<Path>) -> PathBuf {
    home.as_ref().join(DATA_DIRECTORY)
}

pub fn sqlite_database(home: impl AsRef<Path>) -> PathBuf {
    data_dir(home).join(SQLITE_DATABASE_FILE)
}

pub fn default_data_dir() -> PathBuf {
    data_dir(home_dir())
}

pub fn default_sqlite_database() -> PathBuf {
    sqlite_database(home_dir())
}

fn home_dir() -> PathBuf {
    safe_env::var_os("HOME")
        .or_else(|| safe_env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
