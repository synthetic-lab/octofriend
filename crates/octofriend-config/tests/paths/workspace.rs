use std::path::PathBuf;

use octofriend_config::paths::resolve_workspace_path;

#[test]
fn resolves_relative_paths_against_workspace_root_and_preserves_absolute_paths() {
    assert_eq!(
        resolve_workspace_path("/workspace/project", "src/main.ts"),
        PathBuf::from("/workspace/project/src/main.ts")
    );
    assert_eq!(
        resolve_workspace_path("/workspace/project", "/tmp/file.txt"),
        PathBuf::from("/tmp/file.txt")
    );
}
