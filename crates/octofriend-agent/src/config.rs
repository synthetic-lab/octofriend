use env as safe_env;
use octofriend_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Map, Value, json};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const INVALID_PARAMS: i64 = -32602;
const SYNTHETIC_SEARCH_URL: &str = "https://api.synthetic.new/v2/search";

type JsonObject = Map<String, Value>;

#[derive(Debug, Deserialize)]
struct ConfigParams {
    config: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigModelKeyParams {
    model: Value,
    config: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigBaseUrlParams {
    #[serde(rename = "baseUrl")]
    base_url: String,
    config: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ConfigSearchParams {
    config: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigWriteKeyParams {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigMergeEnvVarParams {
    config: Value,
    model: Value,
    #[serde(rename = "apiEnvVar")]
    api_env_var: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigMergeAutofixEnvVarParams {
    config: Value,
    key: String,
    model: Value,
    #[serde(rename = "apiEnvVar")]
    api_env_var: String,
}

#[derive(Debug, Deserialize)]
struct ConfigRunNotifyParams {
    config: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSelectModelParams {
    config: Value,
    model_override: Option<String>,
}

pub(super) fn config_migrate_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let migrated = octofriend_config::files::migrate_config(params.config);
    let Ok(config) = octofriend_config::schema::validate_config(migrated) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid config", None);
    };
    create_json_rpc_success(id, json!({ "config": config }))
}

pub(super) fn config_sanitize_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(config) = octofriend_config::schema::validate_config(params.config) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid config", None);
    };
    create_json_rpc_success(
        id,
        json!({ "config": octofriend_config::files::sanitize_config(config) }),
    )
}

pub(super) fn config_key_for_model_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    config_params_success::<ConfigModelKeyParams>(
        id,
        params,
        |params| json!({ "result": key_for_model_result(&params.model, params.config.as_ref()) }),
    )
}

pub(super) fn config_key_for_base_url_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    config_params_success::<ConfigBaseUrlParams>(
        id,
        params,
        |params| json!({ "result": key_for_base_url_result(&params.base_url, params.config.as_ref()) }),
    )
}

pub(super) fn config_search_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigSearchParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    create_json_rpc_success(
        id,
        json!({ "search": search_config(params.config.as_ref()) }),
    )
}

pub(super) fn config_has_existing_key_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    config_params_success::<ConfigBaseUrlParams>(
        id,
        params,
        |params| json!({ "hasExistingKey": has_existing_key(&params.base_url, params.config.as_ref()) }),
    )
}

fn config_params_success<T>(
    id: JsonRpcId,
    params: Option<Value>,
    result: impl FnOnce(T) -> Value,
) -> JsonRpcResponse
where
    T: DeserializeOwned,
{
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<T>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    create_json_rpc_success(id, result(params))
}

pub(super) fn config_write_key_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigWriteKeyParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    if write_key_for_base_url(&params.base_url, &params.api_key).is_err() {
        return create_json_rpc_error(id, INVALID_PARAMS, "Could not write key file", None);
    }
    create_json_rpc_success(id, json!({}))
}

pub(super) fn config_merge_env_var_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigMergeEnvVarParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    match octofriend_config::files::merge_env_var(params.config, &params.model, &params.api_env_var) {
        Some(config) => create_json_rpc_success(id, json!({ "config": config })),
        None => create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None),
    }
}

pub(super) fn config_merge_autofix_env_var_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigMergeAutofixEnvVarParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    match octofriend_config::files::merge_autofix_env_var(
        params.config,
        &params.key,
        &params.model,
        &params.api_env_var,
    ) {
        Some(config) => create_json_rpc_success(id, json!({ "config": config })),
        None => create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None),
    }
}

pub(super) fn config_select_model_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigSelectModelParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    match octofriend_config::models::selected_model_from_config(
        &params.config,
        params.model_override.as_deref(),
    ) {
        Some(model) => {
            let key_result = key_for_model_result(&model, Some(&params.config));
            create_json_rpc_success(id, json!({ "model": model, "keyResult": key_result }))
        }
        None => create_json_rpc_error(id, INVALID_PARAMS, "Invalid config", None),
    }
}

pub(super) fn config_run_notify_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConfigRunNotifyParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    match run_notify_command(&params.config) {
        Ok(()) => create_json_rpc_success(id, json!({})),
        Err(message) => create_json_rpc_error(id, INVALID_PARAMS, message, None),
    }
}

pub(super) fn config_default_paths_response(id: JsonRpcId) -> JsonRpcResponse {
    create_json_rpc_success(
        id,
        json!({
            "configDir": octofriend_config::paths::default_config_dir(),
            "configFile": octofriend_config::paths::default_config_file(),
            "keyFile": octofriend_config::paths::default_key_file(),
        }),
    )
}

pub(super) fn config_autofix_keys_response(id: JsonRpcId) -> JsonRpcResponse {
    create_json_rpc_success(id, json!({ "keys": octofriend_config::files::AUTOFIX_KEYS }))
}

fn run_notify_command(config: &Value) -> Result<(), String> {
    let Some(cmd) = config
        .get("notifications")
        .and_then(Value::as_object)
        .and_then(|notifications| notifications.get("notifyCommand"))
        .and_then(Value::as_str)
    else {
        return Ok(());
    };
    if cmd.trim().is_empty() {
        return Ok(());
    }
    let (shell, shell_arg) = platform_shell();
    let status = Command::new(shell)
        .arg(shell_arg)
        .arg(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "notifyFinishCommand exited with code {}",
            status.code().unwrap_or(-1)
        ))
    }
}

#[cfg(windows)]
fn platform_shell() -> (String, &'static str) {
    (
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
        "/C",
    )
}

#[cfg(not(windows))]
fn platform_shell() -> (String, &'static str) {
    (
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
        "-c",
    )
}

fn key_for_model_result(model: &Value, config: Option<&Value>) -> Value {
    if let Some(auth) = auth_for_model(model) {
        if auth_uses_chatgpt_oauth(&auth) && !model_supports_chatgpt_oauth(model) {
            return key_error_result(
                "invalid",
                "ChatGPT OAuth is only supported for OpenAI providers.".to_string(),
            );
        }
        let result = resolve_auth_result(&auth);
        return result;
    }
    if let Some(env_var) = provider_env_var_for_model_type(model, config)
        && let Some(key) = safe_env::var(&env_var)
            .ok()
            .and_then(|value| env_value_key(&value))
    {
        return ok_key_result(key);
    }
    let Some(base_url) = model.get("baseUrl").and_then(Value::as_str) else {
        return key_error_result("missing", "No API key found for unknown model".to_string());
    };
    key_for_base_url_result(base_url, config)
}

fn key_for_base_url_result(base_url: &str, config: Option<&Value>) -> Value {
    if let Some(env_var) = provider_env_var_for_base_url(base_url, config)
        && let Some(key) = safe_env::var(&env_var)
            .ok()
            .and_then(|value| env_value_key(&value))
    {
        return ok_key_result(key);
    }
    if let Some(key) = key_file_api_key(base_url) {
        return ok_key_result(key);
    }
    if let Some(key) = configured_model_key(base_url, config) {
        return ok_key_result(key);
    }
    key_error_result("missing", format!("No API key found for {base_url}"))
}

fn search_config(config: Option<&Value>) -> Value {
    if let Some(search) = config
        .and_then(Value::as_object)
        .and_then(|config| config.get("search"))
        .and_then(Value::as_object)
    {
        let url = search
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or(SYNTHETIC_SEARCH_URL);
        let key = auth_for_record(search)
            .and_then(|auth| {
                let result = resolve_auth_result(&auth);
                result
                    .get("key")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .or_else(|| {
                key_for_base_url_result(url, config)
                    .get("key")?
                    .as_str()
                    .map(str::to_string)
            });
        return key
            .map(|key| json!({ "url": url, "key": key }))
            .unwrap_or(Value::Null);
    }

    find_synthetic_key(config)
        .map(|key| json!({ "url": SYNTHETIC_SEARCH_URL, "key": key }))
        .unwrap_or(Value::Null)
}

fn has_existing_key(base_url: &str, config: Option<&Value>) -> bool {
    if key_for_base_url_result(base_url, config)
        .get("ok")
        .and_then(Value::as_bool)
        == Some(true)
    {
        return true;
    }
    if octofriend_config::auth::is_synthetic_base_url(base_url) {
        return octofriend_config::auth::SYNTHETIC_BASE_URLS
            .iter()
            .filter(|url| **url != base_url)
            .any(|url| {
                key_for_base_url_result(url, config)
                    .get("ok")
                    .and_then(Value::as_bool)
                    == Some(true)
            });
    }
    false
}

fn find_synthetic_key(config: Option<&Value>) -> Option<String> {
    if let Some(overrides) = config
        .and_then(Value::as_object)
        .and_then(|config| config.get("defaultApiKeyOverrides"))
        .and_then(Value::as_object)
        && let Some(env_var) = overrides.get("synthetic").and_then(Value::as_str)
        && let Some(key) = safe_env::var(env_var)
            .ok()
            .and_then(|value| env_value_key(&value))
    {
        return Some(key);
    }
    for base_url in octofriend_config::auth::SYNTHETIC_BASE_URLS {
        let result = key_for_base_url_result(base_url, config);
        if let Some(key) = result.get("key").and_then(Value::as_str) {
            return Some(key.to_string());
        }
    }
    None
}

fn auth_for_model(model: &Value) -> Option<Value> {
    let model = model.as_object()?;
    if let Some(auth) = model.get("auth").and_then(Value::as_object) {
        return Some(Value::Object(auth.clone()));
    }
    if let Some(env_var) = model.get("apiEnvVar").and_then(Value::as_str) {
        return Some(json!({ "type": "env", "name": env_var }));
    }
    None
}

fn auth_for_record(record: &JsonObject) -> Option<Value> {
    if let Some(auth) = record.get("auth") {
        return Some(auth.clone());
    }
    record
        .get("apiEnvVar")
        .and_then(Value::as_str)
        .map(|name| json!({ "type": "env", "name": name }))
}

fn configured_model_key(base_url: &str, config: Option<&Value>) -> Option<String> {
    let config = config?.as_object()?;
    if let Some(models) = config.get("models").and_then(Value::as_array) {
        for model in models {
            if let Some(key) = configured_model_entry_key(base_url, model) {
                return Some(key);
            }
        }
    }
    for key in octofriend_config::files::AUTOFIX_KEYS {
        if let Some(model) = config.get(*key)
            && let Some(key) = configured_model_entry_key(base_url, model)
        {
            return Some(key);
        }
    }
    None
}

fn configured_model_entry_key(base_url: &str, model: &Value) -> Option<String> {
    if !model
        .get("baseUrl")
        .and_then(Value::as_str)
        .is_some_and(|model_base_url| {
            octofriend_config::models::base_urls_match(model_base_url, base_url)
        })
    {
        return None;
    }
    let result = auth_for_model(model).and_then(|auth| {
        if auth_uses_chatgpt_oauth(&auth) && !model_supports_chatgpt_oauth(model) {
            return None;
        }
        Some(resolve_auth_result(&auth))
    });
    if let Some(result) = result
        && let Some(key) = result.get("key").and_then(Value::as_str)
    {
        return Some(key.to_string());
    }
    None
}

fn provider_env_var_for_base_url(base_url: &str, config: Option<&Value>) -> Option<String> {
    let overrides = default_api_key_overrides(config);
    octofriend_config::auth::provider_env_var_for_base_url(base_url, overrides.as_ref())
}

fn provider_env_var_for_model_type(model: &Value, config: Option<&Value>) -> Option<String> {
    let provider = model
        .as_object()
        .and_then(octofriend_config::models::provider_for_model_object)?;
    let overrides = default_api_key_overrides(config);
    Some(octofriend_config::auth::default_env_var(
        provider,
        overrides.as_ref(),
    ))
}

fn default_api_key_overrides(config: Option<&Value>) -> Option<octofriend_config::auth::ApiKeyMap> {
    config
        .and_then(Value::as_object)
        .and_then(|config| config.get("defaultApiKeyOverrides"))
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                .collect::<octofriend_config::auth::ApiKeyMap>()
        })
}

fn auth_uses_chatgpt_oauth(auth: &Value) -> bool {
    auth.as_object()
        .and_then(|auth| auth.get("credential"))
        .and_then(Value::as_str)
        == Some("chatgpt-oauth")
}

fn model_supports_chatgpt_oauth(model: &Value) -> bool {
    let Some(model) = model.as_object() else {
        return false;
    };
    let provider = octofriend_config::models::provider_for_model_object(model);
    provider.is_some_and(|provider| {
        provider
            .connection
            .auth_methods
            .contains(&octofriend_config::models::ProviderAuthMethod::ChatGptOAuth)
    })
}

fn resolve_auth_result(auth: &Value) -> Value {
    let Some(auth) = auth.as_object() else {
        return key_error_result("invalid", "Invalid auth configuration".to_string());
    };
    match auth.get("type").and_then(Value::as_str) {
        Some("env") => {
            let Some(name) = auth
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
            else {
                return key_error_result("invalid", "Environment auth name is missing".to_string());
            };
            safe_env::var(name)
                .ok()
                .and_then(|value| env_value_key(&value))
                .or_else(|| {
                    (auth.get("credential").and_then(Value::as_str) == Some("chatgpt-oauth"))
                        .then(codex_file_key)
                        .flatten()
                })
                .map_or_else(
                    || {
                        key_error_result(
                            "missing",
                            format!("Environment variable {name} is not set"),
                        )
                    },
                    ok_key_result,
                )
        }
        Some("command") => command_auth_result(auth),
        _ => key_error_result("invalid", "Invalid auth configuration".to_string()),
    }
}

fn codex_file_key() -> Option<String> {
    let home = safe_env::var("HOME").ok()?;
    for path in [
        format!("{home}/.codex/auth.json"),
        format!("{home}/.config/octofriend/oauth.json5"),
        format!("{home}/.config/octofriend/oauth.json"),
    ] {
        let Ok(contents) = std::fs::read_to_string(path) else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&contents) else { continue };
        let access = value
            .pointer("/codex/access")
            .or_else(|| value.get("access"))
            .and_then(Value::as_str)
            .and_then(env_value_key);
        if access.is_some() {
            return access.map(|token| format!("codex-oauth:{token}"));
        }
    }
    None
}

fn env_value_key(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn key_file_api_key(base_url: &str) -> Option<String> {
    octofriend_config::auth::parse_api_key_map(
        &std::fs::read_to_string(octofriend_config::paths::default_key_file()).ok()?,
    )
    .into_iter()
    .find_map(|(key_base_url, api_key)| {
        octofriend_config::models::base_urls_match(&key_base_url, base_url).then_some(api_key)
    })
}

fn write_key_for_base_url(base_url: &str, api_key: &str) -> std::io::Result<()> {
    let Some(api_key) = env_value_key(api_key) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "API key is empty",
        ));
    };
    let key_file = octofriend_config::paths::default_key_file();
    let mut keys = std::fs::read_to_string(&key_file)
        .ok()
        .map(|contents| octofriend_config::auth::parse_api_key_map(&contents))
        .unwrap_or_default();
    upsert_key_file_key(&mut keys, base_url, &api_key);
    if let Some(parent) = key_file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(
        key_file,
        json5::to_string(&keys).unwrap_or_else(|_| serde_json::json!({}).to_string()),
    )
}

fn upsert_key_file_key(keys: &mut octofriend_config::auth::ApiKeyMap, base_url: &str, api_key: &str) {
    let normalized_base_url = normalize_key_file_base_url(base_url);
    keys.retain(|key_base_url, _| {
        !octofriend_config::models::base_urls_match(key_base_url, &normalized_base_url)
    });
    keys.insert(normalized_base_url, api_key.to_string());
}

fn normalize_key_file_base_url(base_url: &str) -> String {
    let mut normalized = base_url.trim();
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized = &normalized[..normalized.len() - 1];
    }
    normalized.to_string()
}

fn command_auth_result(auth: &JsonObject) -> Value {
    let Some(command) = auth.get("command").and_then(Value::as_array) else {
        return key_error_result("invalid", "Auth command is empty".to_string());
    };
    let Some(program) = command
        .first()
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|program| !program.is_empty())
    else {
        return key_error_result("invalid", "Auth command is empty".to_string());
    };
    let mut args = Vec::with_capacity(command.len().saturating_sub(1));
    for arg in command.iter().skip(1) {
        let Some(arg) = arg.as_str() else {
            return key_error_result(
                "invalid",
                "Auth command arguments must be strings".to_string(),
            );
        };
        args.push(arg);
    }
    let mut child = match Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return command_failed_key_result(error.to_string(), None, None),
    };
    let Some(stdout) = child.stdout.take() else {
        return command_failed_key_result(
            "Could not read auth command stdout".to_string(),
            None,
            None,
        );
    };
    let Some(stderr) = child.stderr.take() else {
        return command_failed_key_result(
            "Could not read auth command stderr".to_string(),
            None,
            None,
        );
    };
    let stdout_receiver = read_limited_stream(stdout);
    let stderr_receiver = read_limited_stream(stderr);
    let deadline =
        Instant::now() + Duration::from_millis(octofriend_config::auth::AUTH_COMMAND_TIMEOUT_MS);
    loop {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return command_failed_key_result(
                format!(
                    "Auth command timed out after {}ms",
                    octofriend_config::auth::AUTH_COMMAND_TIMEOUT_MS
                ),
                None,
                None,
            );
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                let stdout = stdout_receiver.recv_timeout(remaining).unwrap_or_default();
                let stderr = stderr_receiver.recv_timeout(remaining).unwrap_or_default();
                let stderr = String::from_utf8_lossy(&stderr)
                    .chars()
                    .take(500)
                    .collect::<String>();
                if !status.success() {
                    return command_failed_key_result(
                        format!("Auth command exited with status {status}"),
                        status.code(),
                        Some(stderr),
                    );
                }
                if stdout.len() > octofriend_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES {
                    return key_error_result(
                        "invalid",
                        "Auth command output exceeded maximum size".to_string(),
                    );
                }
                let stdout = String::from_utf8_lossy(&stdout);
                let key = stdout.trim();
                return if key.is_empty() {
                    key_error_result("invalid", "Auth command returned empty output".to_string())
                } else {
                    ok_key_result(key)
                };
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => return command_failed_key_result(error.to_string(), None, None),
        }
    }
}

fn read_limited_stream(mut stream: impl Read + Send + 'static) -> mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut limited = stream
            .by_ref()
            .take(octofriend_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES as u64 + 1);
        let mut buffer = Vec::new();
        let _ = limited.read_to_end(&mut buffer);
        let _ = sender.send(buffer);
    });
    receiver
}

fn ok_key_result(key: impl Into<String>) -> Value {
    json!({ "ok": true, "key": key.into() })
}

fn key_error_result(error_type: &'static str, message: String) -> Value {
    json!({ "ok": false, "error": { "type": error_type, "message": message } })
}

fn command_failed_key_result(
    message: String,
    exit_code: Option<i32>,
    stderr: Option<String>,
) -> Value {
    let mut error = Map::new();
    error.insert("type".into(), Value::String("command_failed".into()));
    error.insert("message".into(), Value::String(message));
    if let Some(exit_code) = exit_code {
        error.insert("exitCode".into(), Value::from(exit_code));
    }
    if let Some(stderr) = stderr
        && !stderr.is_empty()
    {
        error.insert("stderr".into(), Value::String(stderr));
    }
    json!({ "ok": false, "error": Value::Object(error) })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{env_value_key, upsert_key_file_key};

    #[test]
    fn env_value_key_trims_and_rejects_whitespace_only_values() {
        assert_eq!(env_value_key(" key "), Some("key".to_string()));
        assert_eq!(env_value_key(" \n\t "), None);
        assert_eq!(env_value_key(""), None);
    }

    #[test]
    fn upsert_key_file_key_normalizes_base_urls_and_replaces_equivalent_entries() {
        let mut keys = BTreeMap::from([
            (
                "https://api.openai.com/v1/".to_string(),
                "old-openai".to_string(),
            ),
            (
                "https://api.anthropic.com".to_string(),
                "anthropic".to_string(),
            ),
        ]);

        upsert_key_file_key(&mut keys, " https://api.openai.com/v1 ", "new-openai");

        assert_eq!(
            keys,
            BTreeMap::from([
                (
                    "https://api.anthropic.com".to_string(),
                    "anthropic".to_string(),
                ),
                (
                    "https://api.openai.com/v1".to_string(),
                    "new-openai".to_string(),
                ),
            ])
        );
    }

    #[test]
    fn write_key_for_base_url_rejects_empty_api_keys() {
        assert!(
            super::write_key_for_base_url(
                "https://api.example.test/v1",
                "
	 "
            )
            .is_err()
        );
    }
}
