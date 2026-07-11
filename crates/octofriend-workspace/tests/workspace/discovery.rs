use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use octofriend_workspace::local::LocalTransport;
use octofriend_workspace::workspace::{FindFilesOptions, find_files};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn temp_dir(name: &str) -> std::io::Result<PathBuf> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "octofriend-workspace-find-{name}-{}-{id}",
        std::process::id()
    ));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn remove_dir(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

#[test]
fn finds_relative_files_with_pruning_filters_max_depth_and_result_caps() -> std::io::Result<()> {
    let root = temp_dir("find")?;
    let transport = LocalTransport::new(&root);
    fs::create_dir_all(root.join("src/nested"))
        .unwrap_or_else(|error| panic!("failed to create src dirs: {error}"));
    fs::create_dir_all(root.join("node_modules/pkg"))
        .unwrap_or_else(|error| panic!("failed to create node_modules dirs: {error}"));
    for file in [
        "src/a.ts",
        "src/b.test.ts",
        "src/nested/c.ts",
        "node_modules/pkg/hidden.ts",
    ] {
        fs::write(root.join(file), "")
            .unwrap_or_else(|error| panic!("failed to write {file}: {error}"));
    }

    let files = find_files(
        &transport,
        &FindFilesOptions {
            include_name: Some("*.ts".into()),
            exclude_name: Some("*.test.ts".into()),
            ..FindFilesOptions::default()
        },
    )
    .unwrap_or_else(|error| panic!("failed to find files: {error}"));
    assert_eq!(files, ["src/a.ts", "src/nested/c.ts"]);

    let capped = find_files(
        &transport,
        &FindFilesOptions {
            path: Some(root.join("src")),
            include_name: Some("*.ts".into()),
            exclude_name: Some("*.test.ts".into()),
            max_depth: Some(1),
            max_results: Some(1),
            ..FindFilesOptions::default()
        },
    )
    .unwrap_or_else(|error| panic!("failed to find capped files: {error}"));
    assert_eq!(capped, ["a.ts"]);

    remove_dir(&root);
    Ok(())
}
