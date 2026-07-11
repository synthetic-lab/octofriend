use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use octofriend_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use octofriend_workspace::docker::DockerTransport;
use octofriend_workspace::local::{DirectoryEntry, LocalTransport, TransportError, TransportResult};
use octofriend_workspace::ssh::SshTransport;
use octofriend_workspace::workspace::{FindFilesEntryType, FindFilesOptions, find_files};
use serde::Deserialize;
use serde_json::{Value, json};

const INVALID_PARAMS: i64 = -32602;

type RemoteStringResult = TransportResult<String>;
type RemoteEntriesResult = TransportResult<Vec<DirectoryEntry>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalTransportParams {
    cwd: PathBuf,
    operation: String,
    path: Option<String>,
    contents: Option<String>,
    command: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DockerTransportParams {
    container: String,
    cwd: Option<String>,
    operation: String,
    path: Option<String>,
    contents: Option<String>,
    command: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshTransportParams {
    target: String,
    cwd: Option<String>,
    operation: String,
    path: Option<String>,
    contents: Option<String>,
    command: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FindFilesParams {
    cwd: PathBuf,
    options: Option<FindFilesOptionsParam>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FindFilesOptionsParam {
    path: Option<PathBuf>,
    include_name: Option<String>,
    include_path: Option<String>,
    exclude_name: Option<String>,
    exclude_path: Option<String>,
    case_insensitive: Option<bool>,
    #[serde(rename = "type")]
    entry_type: Option<String>,
    max_depth: Option<usize>,
    max_results: Option<usize>,
}

struct RemoteTransportParts {
    operation: String,
    cwd: Option<String>,
    path: Option<String>,
    contents: Option<String>,
    command: Option<String>,
    timeout_ms: Option<u64>,
    kind: RemoteTransportKind,
}

#[derive(Debug)]
enum RemoteTransportKind {
    Docker { container: String },
    Ssh { target: String },
}

enum RemoteTransportInstance {
    Docker(DockerTransport),
    Ssh(SshTransport),
}

impl RemoteTransportKind {
    fn into_transport(self, cwd: String) -> RemoteTransportInstance {
        match self {
            Self::Docker { container } => {
                RemoteTransportInstance::Docker(DockerTransport::new(container, cwd))
            }
            Self::Ssh { target } => RemoteTransportInstance::Ssh(SshTransport::new(target, cwd)),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetEnvParams {
    cwd: PathBuf,
    name: String,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DockerRunParams {
    args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct DockerKillParams {
    container: String,
}

pub(super) fn transport_local_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return invalid_params(id);
    };
    let Ok(params) = serde_json::from_value::<LocalTransportParams>(params) else {
        return invalid_params(id);
    };
    let transport = LocalTransport::new(&params.cwd);
    let result = match params.operation.as_str() {
        "writeFile" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            let Some(contents) = params.contents else {
                return invalid_params(id);
            };
            transport.write_file(path, &contents).map(|()| json!({}))
        }
        "readFile" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport
                .read_file(path)
                .map(|contents| json!({ "contents": contents }))
        }
        "modTime" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport
                .mod_time(path)
                .map(|mtime| json!({ "mtime": mtime }))
        }
        "resolvePath" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            Ok(json!({ "path": transport.resolve_path(path).to_string_lossy() }))
        }
        "mkdir" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport.mkdir(path).map(|()| json!({}))
        }
        "readdir" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport.readdir(path).map(|entries| {
                json!({
                    "entries": entries.into_iter().map(|entry| json!({
                        "entry": entry.entry,
                        "isDirectory": entry.is_directory,
                    })).collect::<Vec<_>>()
                })
            })
        }
        "pathExists" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            Ok(json!({ "exists": transport.path_exists(path) }))
        }
        "isDirectory" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            Ok(json!({ "isDirectory": transport.is_directory(path) }))
        }
        "shell" => {
            let Some(command) = params.command else {
                return invalid_params(id);
            };
            transport
                .shell(&command, timeout(params.timeout_ms))
                .map(|output| json!({ "output": output }))
        }
        _ => return invalid_params(id),
    };
    result_response(id, result)
}

pub(super) fn transport_docker_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    remote_transport_parts_response(id, params.and_then(docker_remote_transport_parts))
}

pub(super) fn transport_ssh_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    remote_transport_parts_response(id, params.and_then(ssh_remote_transport_parts))
}

fn docker_remote_transport_parts(params: Value) -> Option<RemoteTransportParts> {
    serde_json::from_value::<DockerTransportParams>(params)
        .ok()
        .map(docker_parts)
}

fn ssh_remote_transport_parts(params: Value) -> Option<RemoteTransportParts> {
    serde_json::from_value::<SshTransportParams>(params)
        .ok()
        .map(ssh_parts)
}

fn docker_parts(params: DockerTransportParams) -> RemoteTransportParts {
    RemoteTransportParts {
        operation: params.operation,
        cwd: params.cwd,
        path: params.path,
        contents: params.contents,
        command: params.command,
        timeout_ms: params.timeout_ms,
        kind: RemoteTransportKind::Docker {
            container: params.container,
        },
    }
}

fn ssh_parts(params: SshTransportParams) -> RemoteTransportParts {
    RemoteTransportParts {
        operation: params.operation,
        cwd: params.cwd,
        path: params.path,
        contents: params.contents,
        command: params.command,
        timeout_ms: params.timeout_ms,
        kind: RemoteTransportKind::Ssh {
            target: params.target,
        },
    }
}

fn remote_transport_parts_response(
    id: JsonRpcId,
    parts: Option<RemoteTransportParts>,
) -> JsonRpcResponse {
    let Some(parts) = parts else {
        return invalid_params(id);
    };
    remote_transport_response(id, parts)
}

trait RemoteTransport {
    fn shell(&self, command: &str, timeout: Duration) -> RemoteStringResult;
    fn write_file(&self, path: &str, contents: &str) -> TransportResult<()>;
    fn read_file(&self, path: &str) -> RemoteStringResult;
    fn readdir(&self, path: &str) -> RemoteEntriesResult;
    fn path_exists(&self, path: &str) -> bool;
}

impl RemoteTransport for RemoteTransportInstance {
    fn shell(&self, command: &str, timeout: Duration) -> RemoteStringResult {
        match self {
            Self::Docker(transport) => transport.shell(command, timeout),
            Self::Ssh(transport) => transport.shell(command, timeout),
        }
    }

    fn write_file(&self, path: &str, contents: &str) -> TransportResult<()> {
        match self {
            Self::Docker(transport) => transport.write_file(path, contents),
            Self::Ssh(transport) => transport.write_file(path, contents),
        }
    }

    fn read_file(&self, path: &str) -> RemoteStringResult {
        match self {
            Self::Docker(transport) => transport.read_file(path),
            Self::Ssh(transport) => transport.read_file(path),
        }
    }

    fn readdir(&self, path: &str) -> RemoteEntriesResult {
        match self {
            Self::Docker(transport) => transport.readdir(path),
            Self::Ssh(transport) => transport.readdir(path),
        }
    }

    fn path_exists(&self, path: &str) -> bool {
        match self {
            Self::Docker(transport) => transport.path_exists(path),
            Self::Ssh(transport) => transport.path_exists(path),
        }
    }
}

fn remote_transport_response(id: JsonRpcId, parts: RemoteTransportParts) -> JsonRpcResponse {
    let RemoteTransportParts {
        operation,
        cwd,
        path,
        contents,
        command,
        timeout_ms,
        kind,
    } = parts;
    if operation == "cwd" {
        let transport = kind.into_transport(".".into());
        return result_response(
            id,
            transport
                .shell("pwd", timeout(timeout_ms))
                .map(|cwd| json!({ "cwd": cwd })),
        );
    }
    let transport = kind.into_transport(cwd.unwrap_or_else(|| "/".into()));
    let result = match operation.as_str() {
        "writeFile" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            let Some(contents) = contents else {
                return invalid_params(id);
            };
            transport.write_file(&path, &contents).map(|()| json!({}))
        }
        "readFile" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            transport
                .read_file(&path)
                .map(|contents| json!({ "contents": contents }))
        }
        "readdir" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            transport.readdir(&path).map(directory_entries_json)
        }
        "pathExists" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            Ok(json!({ "exists": transport.path_exists(&path) }))
        }
        "shell" => {
            let Some(command) = command else {
                return invalid_params(id);
            };
            transport
                .shell(&command, timeout(timeout_ms))
                .map(|output| json!({ "output": output }))
        }
        "modTime" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            remote_stat_mtime(&transport, &path, timeout_ms)
        }
        "resolvePath" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            remote_resolve_path(&transport, &path, timeout_ms)
        }
        "mkdir" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            remote_mkdir(&transport, &path, timeout_ms)
        }
        "isDirectory" => {
            let Some(path) = path else {
                return invalid_params(id);
            };
            Ok(remote_is_directory(&transport, &path))
        }
        _ => return invalid_params(id),
    };
    result_response(id, result)
}

fn directory_entries_json(entries: Vec<DirectoryEntry>) -> Value {
    json!({
        "entries": entries.into_iter().map(|entry| json!({
            "entry": entry.entry,
            "isDirectory": entry.is_directory,
        })).collect::<Vec<_>>()
    })
}

fn remote_stat_mtime<T: RemoteTransport>(
    transport: &T,
    path: &str,
    timeout_ms: Option<u64>,
) -> Result<Value, TransportError> {
    transport
        .shell(
            &format!("stat -c %Y -- '{}'", path.replace('\'', "'\\''")),
            timeout(timeout_ms),
        )
        .map(|output| {
            let seconds = output.trim().parse::<f64>().unwrap_or_default();
            json!({ "mtime": seconds * 1000.0 })
        })
}

fn remote_resolve_path<T: RemoteTransport>(
    transport: &T,
    path: &str,
    timeout_ms: Option<u64>,
) -> Result<Value, TransportError> {
    transport
        .shell(
            &format!("readlink -f -- '{}'", path.replace('\'', "'\\''")),
            timeout(timeout_ms),
        )
        .map(|output| json!({ "path": output.trim() }))
}

fn remote_mkdir<T: RemoteTransport>(
    transport: &T,
    path: &str,
    timeout_ms: Option<u64>,
) -> Result<Value, TransportError> {
    transport
        .shell(
            &format!("mkdir -p -- '{}'", path.replace('\'', "'\\''")),
            timeout(timeout_ms),
        )
        .map(|_| json!({}))
}

fn remote_is_directory<T: RemoteTransport>(transport: &T, path: &str) -> Value {
    json!({
        "isDirectory": transport
            .shell(&format!("test -d -- '{}'", path.replace('\'', "'\\''")), Duration::from_secs(10))
            .is_ok()
    })
}

pub(super) fn transport_find_files_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return invalid_params(id);
    };
    let Ok(params) = serde_json::from_value::<FindFilesParams>(params) else {
        return invalid_params(id);
    };
    let transport = LocalTransport::new(&params.cwd);
    let options = find_options(params.options);
    result_response(
        id,
        find_files(&transport, &options).map(|files| json!({ "files": files })),
    )
}

pub(super) fn transport_get_env_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return invalid_params(id);
    };
    let Ok(params) = serde_json::from_value::<GetEnvParams>(params) else {
        return invalid_params(id);
    };
    let transport = LocalTransport::new(&params.cwd);
    result_response(
        id,
        octofriend_workspace::local::get_env_var(
            &transport,
            &params.name,
            timeout(params.timeout_ms),
        )
        .map(|value| json!({ "value": value })),
    )
}

pub(super) fn transport_docker_run_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return invalid_params(id);
    };
    let Ok(params) = serde_json::from_value::<DockerRunParams>(params) else {
        return invalid_params(id);
    };
    let output = Command::new("docker").arg("run").args(params.args).output();
    match output {
        Ok(output) if output.status.success() => create_json_rpc_success(
            id,
            json!({ "container": String::from_utf8_lossy(&output.stdout).trim() }),
        ),
        Ok(output) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Docker run failed",
            Some(json!({ "message": String::from_utf8_lossy(&output.stderr) })),
        ),
        Err(error) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Docker run failed",
            Some(json!({ "message": error.to_string() })),
        ),
    }
}

pub(super) fn transport_docker_kill_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return invalid_params(id);
    };
    let Ok(params) = serde_json::from_value::<DockerKillParams>(params) else {
        return invalid_params(id);
    };
    let _ = Command::new("docker")
        .arg("kill")
        .arg(params.container)
        .status();
    create_json_rpc_success(id, json!({}))
}

fn find_options(options: Option<FindFilesOptionsParam>) -> FindFilesOptions {
    let Some(options) = options else {
        return FindFilesOptions::default();
    };
    FindFilesOptions {
        path: options.path,
        include_name: options.include_name,
        include_path: options.include_path,
        exclude_name: options.exclude_name,
        exclude_path: options.exclude_path,
        case_insensitive: options.case_insensitive.unwrap_or(false),
        entry_type: match options.entry_type.as_deref() {
            Some("d") => FindFilesEntryType::Directory,
            _ => FindFilesEntryType::File,
        },
        max_depth: options.max_depth,
        max_results: options.max_results,
    }
}

fn timeout(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(timeout_ms.unwrap_or(30_000))
}

fn result_response(id: JsonRpcId, result: Result<Value, TransportError>) -> JsonRpcResponse {
    match result {
        Ok(result) => create_json_rpc_success(id, result),
        Err(error) => create_json_rpc_error(
            id,
            INVALID_PARAMS,
            "Transport operation failed",
            Some(json!({
                "message": error.to_string(),
                "exitCode": match error {
                    TransportError::CommandFailed { exit_code, .. } => exit_code,
                    TransportError::Io { .. } | TransportError::Aborted => None,
                }
            })),
        ),
    }
}

fn invalid_params(id: JsonRpcId) -> JsonRpcResponse {
    create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None)
}
