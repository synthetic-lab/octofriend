use std::fs;

#[cfg(not(windows))]
use octofriend_agent::runtime::{
    AGENTD_TRANSPORT_DOCKER_KILL_METHOD, AGENTD_TRANSPORT_DOCKER_METHOD,
    AGENTD_TRANSPORT_DOCKER_RUN_METHOD,
};
use octofriend_agent::runtime::{
    AGENTD_TRANSPORT_FIND_FILES_METHOD, AGENTD_TRANSPORT_GET_ENV_METHOD,
    AGENTD_TRANSPORT_LOCAL_METHOD, AGENTD_TRANSPORT_SSH_METHOD, handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_root(name: &str) -> std::path::PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("octofriend-{name}-{unique}"));
    fs::create_dir_all(&path).expect("temp root");
    path
}

#[cfg(windows)]
fn local_shell_command() -> &'static str {
    r"cd && type dir\file.txt"
}

#[cfg(not(windows))]
fn local_shell_command() -> &'static str {
    "pwd && cat dir/file.txt"
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
fn local_transport_requests_execute_through_transport() {
    let root = temp_root("transport-local");
    let file = root.join("dir/file.txt");
    fs::create_dir_all(root.join("dir")).expect("write dir");

    let write_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-write",
        "method": AGENTD_TRANSPORT_LOCAL_METHOD,
        "params": {
            "cwd": root,
            "operation": "writeFile",
            "path": file,
            "contents": "hello"
        }
    })
    .to_string();
    let write_response = handle_agentd_json_rpc_line(&write_line).expect("write response");
    let write_value: serde_json::Value = serde_json::from_str(&write_response).expect("json");
    assert_eq!(write_value["result"], json!({}));

    let read_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-read",
        "method": AGENTD_TRANSPORT_LOCAL_METHOD,
        "params": { "cwd": root, "operation": "readFile", "path": file }
    })
    .to_string();
    let read_response = handle_agentd_json_rpc_line(&read_line).expect("read response");
    let read_value: serde_json::Value = serde_json::from_str(&read_response).expect("json");
    assert_eq!(read_value["result"]["contents"], "hello");

    let shell_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-shell",
        "method": AGENTD_TRANSPORT_LOCAL_METHOD,
        "params": {
            "cwd": root,
            "operation": "shell",
            "command": local_shell_command(),
            "timeoutMs": 5000
        }
    })
    .to_string();
    let shell_response = handle_agentd_json_rpc_line(&shell_line).expect("shell response");
    let shell_value: serde_json::Value = serde_json::from_str(&shell_response).expect("json");
    assert!(
        shell_value["result"]["output"]
            .as_str()
            .unwrap()
            .contains("hello")
    );
}

#[cfg(not(windows))]
#[test]
fn docker_transport_requests_execute_through_transport() {
    let root = temp_root("transport-docker");
    let fake_docker = root.join("docker");
    let docker_log = root.join("docker.log");
    fs::write(
        &fake_docker,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\ncase \"$*\" in\n  *pwd*) printf 'image-cwd\\n' ;;\n  *) printf 'remote-output\\n' ;;\nesac\n",
            docker_log.display()
        ),
    )
    .expect("fake docker");
    make_executable(&fake_docker);

    let cwd_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-docker-cwd",
        "method": AGENTD_TRANSPORT_DOCKER_METHOD,
        "params": { "container": "octofriend-test-container", "operation": "cwd" }
    })
    .to_string();
    let cwd_response = run_agentd_with_path(&cwd_line, &root);
    let cwd_value: serde_json::Value = serde_json::from_str(&cwd_response).expect("json");
    assert_eq!(cwd_value["result"]["cwd"], "image-cwd\n");

    let shell_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-docker-shell",
        "method": AGENTD_TRANSPORT_DOCKER_METHOD,
        "params": {
            "container": "octofriend-test-container",
            "cwd": "/work",
            "operation": "shell",
            "command": "printf local-output",
            "timeoutMs": 5000
        }
    })
    .to_string();
    let shell_response = run_agentd_with_path(&shell_line, &root);
    let shell_value: serde_json::Value = serde_json::from_str(&shell_response).expect("json");
    assert_eq!(shell_value["result"]["output"], "remote-output\n");

    let logged = fs::read_to_string(&docker_log).expect("docker log");
    assert!(logged.contains("exec"));
    assert!(logged.contains("octofriend-test-container"));
}

#[cfg(not(windows))]
#[test]
fn docker_run_and_kill_requests_execute_through_transport() {
    let root = temp_root("transport-docker-run");
    let fake_docker = root.join("docker");
    let docker_log = root.join("docker.log");
    fs::write(
        &fake_docker,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\ncase \"$1\" in\n  run) printf 'container-id\\n' ;;\n  kill) true ;;\nesac\n",
            docker_log.display()
        ),
    )
    .expect("fake docker");
    make_executable(&fake_docker);

    let run_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-docker-run",
        "method": AGENTD_TRANSPORT_DOCKER_RUN_METHOD,
        "params": { "args": ["--rm", "alpine"] }
    })
    .to_string();
    let run_response = run_agentd_with_path(&run_line, &root);
    let run_value: serde_json::Value = serde_json::from_str(&run_response).expect("json");
    assert_eq!(run_value["result"]["container"], "container-id");

    let kill_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-docker-kill",
        "method": AGENTD_TRANSPORT_DOCKER_KILL_METHOD,
        "params": { "container": "container-id" }
    })
    .to_string();
    let kill_response = run_agentd_with_path(&kill_line, &root);
    let kill_value: serde_json::Value = serde_json::from_str(&kill_response).expect("json");
    assert_eq!(kill_value["result"], json!({}));

    let logged = fs::read_to_string(&docker_log).expect("docker log");
    assert!(logged.contains("run\n"));
    assert!(logged.contains("kill\n"));
}

#[cfg(not(windows))]
#[test]
fn ssh_transport_requests_execute_through_transport() {
    let root = temp_root("transport-ssh");
    let fake_ssh = root.join("ssh");
    let ssh_log = root.join("ssh.log");
    let remote_cwd = root.join("remote/workspace");
    fs::create_dir_all(&remote_cwd).expect("remote cwd");
    fs::write(remote_cwd.join("marker.txt"), "ssh-output").expect("remote marker");
    fs::write(
        &fake_ssh,
        format!(
            "#!/bin/sh\nprintf 'target=%s command=%s\\n' \"$1\" \"$2\" >> '{}'\ncase \"$2\" in\n  *pwd*) printf '{}\\n' ;;\n  *) shift; /bin/sh -c \"$1\" ;;\nesac\n",
            ssh_log.display(),
            remote_cwd.display()
        ),
    )
    .expect("fake ssh");
    make_executable(&fake_ssh);

    let cwd_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-ssh-cwd",
        "method": AGENTD_TRANSPORT_SSH_METHOD,
        "params": { "target": "user@example.test", "operation": "cwd" }
    })
    .to_string();
    let cwd_response = run_agentd_with_path(&cwd_line, &root);
    let cwd_value: serde_json::Value = serde_json::from_str(&cwd_response).expect("json");
    assert_eq!(
        cwd_value["result"]["cwd"],
        format!("{}\n", remote_cwd.display())
    );

    let shell_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-ssh-shell",
        "method": AGENTD_TRANSPORT_SSH_METHOD,
        "params": {
            "target": "user@example.test",
            "cwd": remote_cwd,
            "operation": "shell",
            "command": "cat marker.txt",
            "timeoutMs": 5000
        }
    })
    .to_string();
    let shell_response = run_agentd_with_path(&shell_line, &root);
    let shell_value: serde_json::Value = serde_json::from_str(&shell_response).expect("json");
    assert_eq!(shell_value["result"]["output"], "ssh-output");

    let logged = fs::read_to_string(&ssh_log).expect("ssh log");
    assert!(logged.contains("user@example.test"));
    assert!(logged.contains("cat marker.txt"));
}

#[test]
fn transport_find_files_and_get_env_are_agentd() {
    let root = temp_root("transport-find");
    fs::create_dir_all(root.join("src")).expect("src dir");
    fs::create_dir_all(root.join("node_modules/pkg")).expect("ignored dir");
    fs::write(root.join("src/main.ts"), "main").expect("main file");
    fs::write(root.join("node_modules/pkg/index.ts"), "ignored").expect("ignored file");

    let find_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-find",
        "method": AGENTD_TRANSPORT_FIND_FILES_METHOD,
        "params": {
            "cwd": root,
            "options": {
                "includeName": "*.ts",
                "maxResults": 10
            }
        }
    })
    .to_string();
    let find_response = handle_agentd_json_rpc_line(&find_line).expect("find response");
    let find_value: serde_json::Value = serde_json::from_str(&find_response).expect("json");
    assert_eq!(find_value["result"]["files"], json!(["src/main.ts"]));

    let env_line = json!({
        "jsonrpc": "2.0",
        "id": "transport-env",
        "method": AGENTD_TRANSPORT_GET_ENV_METHOD,
        "params": { "cwd": root, "name": home_env_var_name(), "timeoutMs": 5000 }
    })
    .to_string();
    let env_response = handle_agentd_json_rpc_line(&env_line).expect("env response");
    let env_value: serde_json::Value = serde_json::from_str(&env_response).expect("json");
    assert!(!env_value["result"]["value"].as_str().unwrap().is_empty());
}

#[cfg(not(windows))]
fn run_agentd_with_path(line: &str, path_dir: &std::path::Path) -> String {
    let binary = env!("CARGO_BIN_EXE_octofriend-agentd");
    let mut child = std::process::Command::new(binary)
        .env(
            "PATH",
            std::env::join_paths(std::iter::once(path_dir.to_path_buf()).chain(
                std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()),
            ))
            .expect("PATH should join"),
        )
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("agentd should spawn");
    {
        use std::io::Write;
        let stdin = child.stdin.as_mut().expect("agentd stdin should be piped");
        writeln!(stdin, "{line}").expect("request should be written");
    }
    drop(child.stdin.take());
    let output = child
        .wait_with_output()
        .expect("agentd output should be collected");
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .expect("agentd stdout should be utf-8")
        .trim_end()
        .to_string()
}

#[cfg(not(windows))]
fn make_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("permissions");
    }
}
