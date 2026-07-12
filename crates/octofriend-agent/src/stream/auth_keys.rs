use env as safe_env;
use std::fmt::Write;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

type JsonObject = Map<String, Value>;

fn non_empty_key(value: &str) -> Option<String> {
    let key = value.trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

pub(super) fn autofix_api_key(config: &JsonObject) -> Option<String> {
    if let Some(api_key) = config.get("apiKey").and_then(Value::as_str)
        && let Some(key) = non_empty_key(api_key)
    {
        return Some(key);
    }

    if let Some(auth_key) = auth_api_key(config.get("auth")) {
        return Some(auth_key);
    }

    if let Some(env_var_key) = env_var_api_key(config.get("apiEnvVar")) {
        return Some(env_var_key);
    }

    let base_url = config.get("baseUrl").and_then(Value::as_str)?;
    if let Some(default_env_key) = default_env_api_key(base_url, config) {
        return Some(default_env_key);
    }

    if let Some(key_file_key) = key_file_api_key(base_url) {
        return Some(key_file_key);
    }

    configured_model_api_key(base_url, config)
}

fn codex_file_access_token() -> Option<String> {
    let home = safe_env::var("HOME").ok()?;
    let paths = [
        format!("{home}/.codex/auth.json"),
        format!("{home}/.config/octofriend/oauth.json5"),
        format!("{home}/.config/octofriend/oauth.json"),
    ];
    for path in paths {
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(&contents) else {
            continue;
        };
        let expired = value
            .pointer("/tokens/expires")
            .or_else(|| value.pointer("/tokens/expires_at"))
            .or_else(|| value.get("expires"))
            .and_then(Value::as_i64)
            .is_some_and(|expires| expires <= now_millis());
        if expired {
            let Some(refresh) = value
                .pointer("/tokens/refresh_token")
                .or_else(|| value.get("refresh"))
                .or_else(|| value.pointer("/codex/refresh"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Ok(response) = reqwest::blocking::Client::new()
                .post("https://auth.openai.com/oauth/token")
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(format!(
                    "grant_type=refresh_token&refresh_token={}&client_id=app_EMoamEEZ73f0CkXaXp7hrann",
                    percent_encode(refresh),
                ))
                .send()
            else {
                continue;
            };
            let Ok(response_text) = response.text() else {
                continue;
            };
            let Ok(token_response) = serde_json::from_str::<Value>(&response_text) else {
                continue;
            };
            let Some(access) = token_response
                .get("access_token")
                .and_then(Value::as_str)
                .and_then(non_empty_key)
            else {
                continue;
            };
            if let Some(tokens) = value.get_mut("tokens").and_then(Value::as_object_mut) {
                tokens.insert("access_token".into(), Value::String(access.clone()));
                if let Some(refresh) = token_response.get("refresh_token").and_then(Value::as_str) {
                    tokens.insert("refresh_token".into(), Value::String(refresh.into()));
                }
                if let Some(expires) = token_response.get("expires_in").and_then(Value::as_i64) {
                    tokens.insert(
                        "expires_at".into(),
                        Value::from(now_millis() + expires * 1000),
                    );
                }
                let _ = std::fs::write(&path, serde_json::to_string_pretty(&value).ok()?);
            }
        }
        let token = value
            .pointer("/tokens/access_token")
            .or_else(|| value.get("access"))
            .or_else(|| value.pointer("/codex/access"))
            .and_then(Value::as_str)
            .and_then(non_empty_key);
        let account_id = value
            .pointer("/tokens/account_id")
            .or_else(|| value.pointer("/tokens/accountId"))
            .or_else(|| value.get("accountId"))
            .or_else(|| value.pointer("/codex/accountId"))
            .and_then(Value::as_str)
            .and_then(non_empty_key);
        if let Some(token) = token {
            return Some(account_id.map_or(token.clone(), |account| {
                format!("{token}|account={account}")
            }));
        }
    }
    None
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| {
            i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
        })
}

fn env_var_api_key(value: Option<&Value>) -> Option<String> {
    let env_var = value.and_then(Value::as_str)?;
    let value = safe_env::var(env_var).ok()?;
    non_empty_key(&value)
}

fn default_env_api_key(base_url: &str, config: &JsonObject) -> Option<String> {
    let overrides = config
        .get("defaultApiKeyOverrides")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                .collect::<octofriend_config::auth::ApiKeyMap>()
        });
    let env_var = octofriend_config::models::provider_for_model_object(config)
        .map(|provider| octofriend_config::auth::default_env_var(provider, overrides.as_ref()))
        .or_else(|| {
            octofriend_config::auth::provider_env_var_for_base_url(base_url, overrides.as_ref())
        })?;
    let value = safe_env::var(env_var).ok()?;
    non_empty_key(&value)
}

fn key_file_api_key(base_url: &str) -> Option<String> {
    let contents = std::fs::read_to_string(octofriend_config::paths::default_key_file()).ok()?;
    octofriend_config::auth::parse_api_key_map(&contents)
        .into_iter()
        .find_map(|(key_base_url, api_key)| {
            octofriend_config::models::base_urls_match(&key_base_url, base_url).then_some(api_key)
        })
}

fn configured_model_api_key(base_url: &str, config: &JsonObject) -> Option<String> {
    let models = config.get("authModels")?.as_array()?;
    for model in models {
        let Some(model) = model.as_object() else {
            continue;
        };
        if !model
            .get("baseUrl")
            .and_then(Value::as_str)
            .is_some_and(|model_base_url| {
                octofriend_config::models::base_urls_match(model_base_url, base_url)
            })
        {
            continue;
        }
        if !model_type_matches(config.get("type").and_then(Value::as_str), model) {
            continue;
        }
        if let Some(auth_key) = auth_api_key(model.get("auth")) {
            return Some(auth_key);
        }
        if let Some(env_key) = env_var_api_key(model.get("apiEnvVar")) {
            return Some(env_key);
        }
    }
    None
}

fn model_type_matches(target_type: Option<&str>, model: &JsonObject) -> bool {
    let Some(target_type) = target_type else {
        return true;
    };
    model
        .get("type")
        .and_then(Value::as_str)
        .is_none_or(|model_type| model_type == target_type)
}

fn auth_api_key(auth: Option<&Value>) -> Option<String> {
    let auth = auth?.as_object()?;
    match auth.get("type").and_then(Value::as_str)? {
        "env" => {
            let name = auth.get("name").and_then(Value::as_str)?;
            let is_oauth = auth.get("credential").and_then(Value::as_str) == Some("chatgpt-oauth");
            let value = safe_env::var(name)
                .ok()
                .and_then(|value| non_empty_key(&value))
                .or_else(|| {
                    (is_oauth && name == "CODEX_ACCESS_TOKEN")
                        .then(|| {
                            safe_env::var("OPENAI_CODEX_ACCESS_TOKEN")
                                .ok()
                                .and_then(|value| non_empty_key(&value))
                        })
                        .flatten()
                })
                .or_else(|| is_oauth.then(codex_file_access_token).flatten())?;
            encode_auth_key(auth, value)
        }
        "command" => command_auth_api_key(auth).and_then(|value| encode_auth_key(auth, value)),
        _ => None,
    }
}

fn encode_auth_key(auth: &JsonObject, value: String) -> Option<String> {
    match auth.get("credential").and_then(Value::as_str) {
        Some("chatgpt-oauth") if !value.starts_with("codex-oauth:") => {
            Some(format!("codex-oauth:{value}"))
        }
        Some("gemini-oauth") => {
            let project = auth.get("project")?.as_str()?.trim();
            if project.is_empty() {
                return None;
            }
            Some(format!("gemini-oauth:{project}|token={value}"))
        }
        _ => Some(value),
    }
}

fn command_auth_api_key(auth: &JsonObject) -> Option<String> {
    let command = auth.get("command")?.as_array()?;
    let program = command.first()?.as_str()?;
    if program.is_empty() {
        return None;
    }
    let args = command
        .iter()
        .skip(1)
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut limited =
            stdout.take(octofriend_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES as u64 + 1);
        let mut buffer = Vec::new();
        let _ = limited.read_to_end(&mut buffer);
        let _ = sender.send(buffer);
    });
    let deadline =
        Instant::now() + Duration::from_millis(octofriend_config::auth::AUTH_COMMAND_TIMEOUT_MS);
    loop {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        match child.try_wait().ok()? {
            Some(status) => {
                if !status.success() {
                    return None;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                let output = receiver.recv_timeout(remaining).ok()?;
                if output.len() > octofriend_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES {
                    return None;
                }
                let stdout = String::from_utf8(output).ok()?;
                let key = stdout.trim();
                return if key.is_empty() {
                    None
                } else {
                    Some(key.to_string())
                };
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct SafeEnvRestore {
        name: &'static str,
        old_value: Option<String>,
    }

    impl SafeEnvRestore {
        fn set(name: &'static str, value: &str) -> Option<Self> {
            let old_value = safe_env::var(name).ok();
            safe_env::set_var(name, value)?;
            Some(Self { name, old_value })
        }
    }

    impl Drop for SafeEnvRestore {
        fn drop(&mut self) {
            if let Some(old_value) = &self.old_value {
                let _ = safe_env::set_var(self.name, old_value);
            } else {
                let _ = safe_env::remove_var(self.name);
            }
        }
    }

    #[test]
    fn autofix_api_key_trims_direct_and_env_keys() {
        let env_restore = SafeEnvRestore::set("octofriend_AUTOFIX_KEY_TEST", " env-key \n");
        let direct = json!({ "apiKey": " direct-key \n" });
        let env_auth = json!({
            "auth": { "type": "env", "name": "octofriend_AUTOFIX_KEY_TEST" }
        });
        let api_env_var = json!({ "apiEnvVar": "octofriend_AUTOFIX_KEY_TEST" });

        assert_eq!(
            autofix_api_key(direct.as_object().unwrap()),
            Some("direct-key".into())
        );
        if env_restore.is_some() {
            assert_eq!(
                autofix_api_key(env_auth.as_object().unwrap()),
                Some("env-key".into())
            );
            assert_eq!(
                autofix_api_key(api_env_var.as_object().unwrap()),
                Some("env-key".into())
            );
        }
    }

    #[test]
    fn autofix_api_key_ignores_blank_direct_and_env_keys() {
        let env_restore = SafeEnvRestore::set("octofriend_AUTOFIX_BLANK_KEY_TEST", " \n");
        let direct = json!({ "apiKey": " \n" });
        let env_auth = json!({
            "auth": { "type": "env", "name": "octofriend_AUTOFIX_BLANK_KEY_TEST" }
        });

        assert_eq!(autofix_api_key(direct.as_object().unwrap()), None);
        if env_restore.is_some() {
            assert_eq!(autofix_api_key(env_auth.as_object().unwrap()), None);
        }
    }
}
