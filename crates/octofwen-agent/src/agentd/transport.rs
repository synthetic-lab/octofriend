use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use octofwen_transport::docker::DockerTransport;
use octofwen_transport::local::{LocalTransport, TransportError};
use octofwen_transport::workspace::{FindFilesEntryType, FindFilesOptions, find_files};
use serde::Deserialize;
use serde_json::{Value, json};

const INVALID_PARAMS: i64 = -32602;

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
    let Some(params) = params else {
        return invalid_params(id);
    };
    let Ok(params) = serde_json::from_value::<DockerTransportParams>(params) else {
        return invalid_params(id);
    };
    if params.operation == "cwd" {
        let transport = DockerTransport::new(params.container, ".");
        return result_response(
            id,
            transport
                .shell("pwd", timeout(params.timeout_ms))
                .map(|cwd| json!({ "cwd": cwd })),
        );
    }
    let cwd = params.cwd.unwrap_or_else(|| "/".into());
    let transport = DockerTransport::new(params.container, cwd);
    let result = match params.operation.as_str() {
        "writeFile" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            let Some(contents) = params.contents else {
                return invalid_params(id);
            };
            transport.write_file(&path, &contents).map(|()| json!({}))
        }
        "readFile" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport
                .read_file(&path)
                .map(|contents| json!({ "contents": contents }))
        }
        "readdir" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport.readdir(&path).map(|entries| {
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
            Ok(json!({ "exists": transport.path_exists(&path) }))
        }
        "shell" => {
            let Some(command) = params.command else {
                return invalid_params(id);
            };
            transport
                .shell(&command, timeout(params.timeout_ms))
                .map(|output| json!({ "output": output }))
        }
        "modTime" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport
                .shell(
                    &format!("stat -c %Y -- '{}'", path.replace('\'', "'\\''")),
                    timeout(params.timeout_ms),
                )
                .map(|output| {
                    let seconds = output.trim().parse::<f64>().unwrap_or_default();
                    json!({ "mtime": seconds * 1000.0 })
                })
        }
        "resolvePath" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport
                .shell(
                    &format!("readlink -f -- '{}'", path.replace('\'', "'\\''")),
                    timeout(params.timeout_ms),
                )
                .map(|output| json!({ "path": output.trim() }))
        }
        "mkdir" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            transport
                .shell(
                    &format!("mkdir -p -- '{}'", path.replace('\'', "'\\''")),
                    timeout(params.timeout_ms),
                )
                .map(|_| json!({}))
        }
        "isDirectory" => {
            let Some(path) = params.path else {
                return invalid_params(id);
            };
            Ok(
                json!({ "isDirectory": transport.shell(&format!("test -d -- '{}'", path.replace('\'', "'\\''")), Duration::from_secs(10)).is_ok() }),
            )
        }
        _ => return invalid_params(id),
    };
    result_response(id, result)
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
        octofwen_transport::local::get_env_var(
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
