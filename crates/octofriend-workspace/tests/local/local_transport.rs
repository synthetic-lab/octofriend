use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use octofriend_workspace::local::{DirectoryEntry, LocalTransport, TransportError, get_env_var};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

fn temp_dir(name: &str) -> std::io::Result<PathBuf> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "octofriend-workspace-{name}-{}-{id}",
        std::process::id()
    ));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn remove_dir(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

#[cfg(windows)]
fn print_working_directory_and_marker_command() -> &'static str {
    "cd && type marker.txt"
}

#[cfg(not(windows))]
fn print_working_directory_and_marker_command() -> &'static str {
    "pwd && cat marker.txt"
}

#[cfg(windows)]
fn failing_command() -> &'static str {
    "echo failed && exit /b 7"
}

#[cfg(not(windows))]
fn failing_command() -> &'static str {
    "echo failed && exit 7"
}

#[cfg(windows)]
fn expected_failed_command_message() -> &'static str {
    "Command exited with code: 7\noutput: failed \n"
}

#[cfg(not(windows))]
fn expected_failed_command_message() -> &'static str {
    "Command exited with code: 7\noutput: failed\n"
}

#[cfg(windows)]
fn sleep_command() -> &'static str {
    "ping -n 2 127.0.0.1 >NUL"
}

#[cfg(not(windows))]
fn sleep_command() -> &'static str {
    "sleep 1"
}

#[cfg(windows)]
fn home_env_var_name() -> &'static str {
    "USERPROFILE"
}

#[cfg(not(windows))]
fn home_env_var_name() -> &'static str {
    "HOME"
}

#[test]
fn reads_writes_resolves_lists_and_stats_local_filesystem_entries() -> std::io::Result<()> {
    let root = temp_dir("filesystem")?;
    let transport = LocalTransport::new(&root);
    let dir = root.join("dir");
    let file = dir.join("file.txt");
    #[cfg(unix)]
    let link = root.join("link-to-dir");

    transport
        .mkdir(&dir)
        .unwrap_or_else(|error| panic!("failed to create dir: {error}"));
    transport
        .write_file(&file, "contents")
        .unwrap_or_else(|error| panic!("failed to write file: {error}"));
    #[cfg(unix)]
    std::os::unix::fs::symlink(&dir, &link)
        .unwrap_or_else(|error| panic!("failed to create symlink: {error}"));

    assert_eq!(
        transport
            .read_file(&file)
            .unwrap_or_else(|error| panic!("failed to read file: {error}")),
        "contents"
    );
    assert!(transport.path_exists(&file));
    assert!(transport.is_directory(&dir));
    assert_eq!(
        transport.resolve_path(root.join("missing.txt")),
        root.join("missing.txt")
    );
    assert!(transport.mod_time(&file).unwrap_or_default() > 0.0);

    let entries = transport
        .readdir(&root)
        .unwrap_or_else(|error| panic!("failed to read directory: {error}"));
    assert!(entries.contains(&DirectoryEntry {
        entry: "dir".into(),
        is_directory: true,
    }));
    #[cfg(unix)]
    assert!(entries.contains(&DirectoryEntry {
        entry: "link-to-dir".into(),
        is_directory: true,
    }));

    remove_dir(&root);
    Ok(())
}

#[test]
fn runs_shell_commands_from_transport_cwd_and_reports_command_failures() -> std::io::Result<()> {
    let root = temp_dir("shell")?;
    let transport = LocalTransport::new(&root);
    fs::write(root.join("marker.txt"), "ok")
        .unwrap_or_else(|error| panic!("failed to write marker: {error}"));

    let output = transport
        .shell(
            print_working_directory_and_marker_command(),
            Duration::from_secs(5),
        )
        .unwrap_or_else(|error| panic!("failed to run shell command: {error}"));
    let normalized_output = output.replace("\r\n", "\n");
    assert!(
        normalized_output.contains(&root.display().to_string()),
        "output did not include cwd: {normalized_output:?}"
    );
    assert!(
        normalized_output.contains("ok"),
        "output did not include marker contents: {normalized_output:?}"
    );

    let error = transport
        .shell(failing_command(), Duration::from_secs(5))
        .expect_err("command should fail");
    match error {
        TransportError::CommandFailed { message, exit_code } => {
            assert_eq!(exit_code, Some(7));
            assert_eq!(
                message.replace("\r\n", "\n"),
                expected_failed_command_message()
            );
        }
        other => panic!("unexpected error: {other}"),
    }

    remove_dir(&root);
    Ok(())
}

#[test]
fn maps_shell_timeouts_to_command_failed_errors() -> std::io::Result<()> {
    let root = temp_dir("timeout")?;
    let transport = LocalTransport::new(&root);

    let error = transport
        .shell(sleep_command(), Duration::from_millis(10))
        .expect_err("command should time out");
    match error {
        TransportError::CommandFailed { message, exit_code } => {
            assert_eq!(exit_code, None);
            assert!(message.starts_with("Command timed out.\noutput:"));
        }
        other => panic!("unexpected error: {other}"),
    }

    remove_dir(&root);
    Ok(())
}

#[test]
fn wraps_missing_file_mtime_failures_in_transport_error() -> std::io::Result<()> {
    let root = temp_dir("mtime")?;
    let transport = LocalTransport::new(&root);
    let error = transport
        .mod_time(root.join("missing.txt"))
        .expect_err("mtime should fail");

    match error {
        TransportError::Io {
            operation, path, ..
        } => {
            assert_eq!(operation, "get modified time for");
            assert!(path.ends_with("missing.txt"));
        }
        other => panic!("unexpected error: {other}"),
    }

    remove_dir(&root);
    Ok(())
}

#[test]
fn reads_environment_variables_from_local_process_environment() -> std::io::Result<()> {
    let root = temp_dir("env")?;
    let transport = LocalTransport::new(&root);

    let missing = get_env_var(
        &transport,
        "octofriend_TRANSPORT_TEST_VALUE_MISSING",
        Duration::from_secs(5),
    )
    .unwrap_or_else(|error| panic!("failed to read missing env var: {error}"));
    assert_eq!(missing, "");

    let home_var = home_env_var_name();
    let home = std::env::var(home_var).unwrap_or_default();
    let value = get_env_var(&transport, home_var, Duration::from_secs(5))
        .unwrap_or_else(|error| panic!("failed to read {home_var} env var: {error}"));
    assert_eq!(value, home);

    remove_dir(&root);
    Ok(())
}
