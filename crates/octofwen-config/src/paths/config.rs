use std::path::{Path, PathBuf};

pub const CONFIG_DIRECTORY: &str = ".config/octofriend";
pub const CONFIG_FILE_NAME: &str = "octofriend.json5";
pub const KEY_FILE_NAME: &str = "keys.json5";

pub fn config_dir(home: impl AsRef<Path>) -> PathBuf {
    home.as_ref().join(CONFIG_DIRECTORY)
}

pub fn config_file(home: impl AsRef<Path>) -> PathBuf {
    config_dir(home).join(CONFIG_FILE_NAME)
}

pub fn key_file(home: impl AsRef<Path>) -> PathBuf {
    config_dir(home).join(KEY_FILE_NAME)
}

pub fn default_config_dir() -> PathBuf {
    config_dir(home_dir())
}

pub fn default_config_file() -> PathBuf {
    config_file(home_dir())
}

pub fn default_key_file() -> PathBuf {
    key_file(home_dir())
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
