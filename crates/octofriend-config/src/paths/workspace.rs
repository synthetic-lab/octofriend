use std::path::{Path, PathBuf};

pub fn resolve_workspace_path(workspace_root: impl AsRef<Path>, path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_root.as_ref().join(path)
    }
}
