use std::path::Path;
use std::time::Duration;

use crate::local::filesystem::{DirectoryEntry, TransportResult};
use crate::shell::shell_quote;

pub(crate) fn write_file_with_shell<F>(
    file: &str,
    contents: &str,
    mut exec_shell: F,
) -> TransportResult<()>
where
    F: FnMut(&str, Duration, Option<&str>) -> TransportResult<String>,
{
    let parent = Path::new(file)
        .parent()
        .and_then(Path::to_str)
        .filter(|parent| !parent.is_empty());
    let mkdir = parent
        .map(|parent| format!("mkdir -p -- {} && ", shell_quote(parent)))
        .unwrap_or_default();
    exec_shell(
        &format!("{mkdir}cat > {}", shell_quote(file)),
        Duration::from_secs(10),
        Some(contents),
    )?;
    Ok(())
}

pub(crate) fn readdir_with_shell<F>(dir: &str, mut shell: F) -> TransportResult<Vec<DirectoryEntry>>
where
    F: FnMut(&str, Duration) -> TransportResult<String>,
{
    let script = format!(
        "for entry in {0}/* {0}/.[!.]* {0}/..?*; do [ -e \"$entry\" ] || continue; name=$(basename \"$entry\"); if [ -d \"$entry\" ]; then printf 'd\\t%s\\n' \"$name\"; else printf 'f\\t%s\\n' \"$name\"; fi; done",
        shell_quote(dir)
    );
    let output = shell(&script, Duration::from_secs(10))?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let (kind, entry) = line.split_once('\t')?;
            Some(DirectoryEntry {
                entry: entry.to_string(),
                is_directory: kind == "d",
            })
        })
        .collect())
}
