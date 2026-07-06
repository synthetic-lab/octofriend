use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::local::LocalTransport;
use crate::local::filesystem::TransportResult;

const EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".turbo",
    ".output",
    "__pycache__",
    ".pytest_cache",
    ".cache",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    ".sst",
    ".webkit-cache",
    "mypy_cache",
    ".history",
    ".gradle",
];

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FindFilesOptions {
    pub path: Option<PathBuf>,
    pub include_name: Option<String>,
    pub include_path: Option<String>,
    pub exclude_name: Option<String>,
    pub exclude_path: Option<String>,
    pub case_insensitive: bool,
    pub entry_type: FindFilesEntryType,
    pub max_depth: Option<usize>,
    pub max_results: Option<usize>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum FindFilesEntryType {
    #[default]
    File,
    Directory,
}

pub fn find_files(
    transport: &LocalTransport,
    options: &FindFilesOptions,
) -> TransportResult<Vec<String>> {
    let root = options.path.as_deref().unwrap_or_else(|| transport.cwd());
    let mut results = Vec::new();
    walk(root, root, 0, options, &mut results)?;
    results.sort();
    if let Some(max_results) = options.max_results.filter(|value| *value > 0) {
        results.truncate(max_results);
    }
    Ok(results)
}

pub fn find_files_with_shell(
    transport: &LocalTransport,
    options: &FindFilesOptions,
) -> TransportResult<Vec<String>> {
    let _ = transport.shell("true", Duration::from_millis(100))?;
    find_files(transport, options)
}

fn walk(
    root: &Path,
    path: &Path,
    depth: usize,
    options: &FindFilesOptions,
    results: &mut Vec<String>,
) -> TransportResult<()> {
    if should_prune(path) && path != root {
        return Ok(());
    }

    if matches_entry(root, path, options)? {
        results.push(relative_path(root, path));
    }

    if options
        .max_depth
        .is_some_and(|max_depth| depth >= max_depth)
    {
        return Ok(());
    }

    let Ok(entries) = fs::read_dir(path) else {
        return Ok(());
    };
    for entry in entries {
        let entry = entry.map_err(|source| crate::local::filesystem::TransportError::Io {
            operation: "read directory entry",
            path: path.display().to_string(),
            source,
        })?;
        let entry_path = entry.path();
        if entry
            .metadata()
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
        {
            walk(root, &entry_path, depth + 1, options, results)?;
        } else if matches_entry(root, &entry_path, options)? {
            results.push(relative_path(root, &entry_path));
        }
    }
    Ok(())
}

fn should_prune(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| EXCLUDED_DIRS.contains(&name))
}

fn matches_entry(root: &Path, path: &Path, options: &FindFilesOptions) -> TransportResult<bool> {
    let metadata =
        fs::metadata(path).map_err(|source| crate::local::filesystem::TransportError::Io {
            operation: "stat",
            path: path.display().to_string(),
            source,
        })?;
    let type_matches = match options.entry_type {
        FindFilesEntryType::File => metadata.is_file(),
        FindFilesEntryType::Directory => metadata.is_dir(),
    };
    if !type_matches {
        return Ok(false);
    }

    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let rel = relative_path(root, path);

    if let Some(include_name) = &options.include_name {
        if !glob_match(include_name, name, options.case_insensitive) {
            return Ok(false);
        }
    }
    if let Some(exclude_name) = &options.exclude_name {
        if glob_match(exclude_name, name, options.case_insensitive) {
            return Ok(false);
        }
    }
    if let Some(include_path) = &options.include_path {
        if !glob_match(include_path, &rel, options.case_insensitive) {
            return Ok(false);
        }
    }
    if let Some(exclude_path) = &options.exclude_path {
        if glob_match(exclude_path, &rel, options.case_insensitive) {
            return Ok(false);
        }
    }

    Ok(true)
}

fn relative_path(root: &Path, path: &Path) -> String {
    if path == root {
        return ".".into();
    }
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn glob_match(pattern: &str, value: &str, case_insensitive: bool) -> bool {
    let pattern = if case_insensitive {
        pattern.to_lowercase()
    } else {
        pattern.to_owned()
    };
    let value = if case_insensitive {
        value.to_lowercase()
    } else {
        value.to_owned()
    };
    wildcard_match(pattern.as_bytes(), value.as_bytes())
}

fn wildcard_match(pattern: &[u8], value: &[u8]) -> bool {
    let (mut pattern_index, mut value_index) = (0, 0);
    let mut star_index = None;
    let mut match_index = 0;

    while value_index < value.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == b'?' || pattern[pattern_index] == value[value_index])
        {
            pattern_index += 1;
            value_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
            star_index = Some(pattern_index);
            match_index = value_index;
            pattern_index += 1;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            match_index += 1;
            value_index = match_index;
        } else {
            return false;
        }
    }

    while pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}
