use std::path::PathBuf;

use octofriend_config::paths::{
    config_dir, config_file, default_config_dir, default_config_file, default_key_file, key_file,
};

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[test]
fn preserves_legacy_octofriend_config_and_key_paths() {
    assert_eq!(
        config_dir("/home/alice"),
        PathBuf::from("/home/alice/.config/octofriend")
    );
    assert_eq!(
        config_file("/home/alice"),
        PathBuf::from("/home/alice/.config/octofriend/octofriend.json5")
    );
    assert_eq!(
        key_file("/home/alice"),
        PathBuf::from("/home/alice/.config/octofriend/keys.json5")
    );
}

#[test]
fn default_config_paths_are_home_relative() {
    let home = home_dir();

    assert_eq!(default_config_dir(), home.join(".config/octofriend"));
    assert_eq!(
        default_config_file(),
        home.join(".config/octofriend/octofriend.json5")
    );
    assert_eq!(
        default_key_file(),
        home.join(".config/octofriend/keys.json5")
    );
}
