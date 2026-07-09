use env as safe_env;
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
                .collect::<octofwen_config::auth::ApiKeyMap>()
        });
    let env_var = octofwen_config::models::provider_for_model_object(config)
        .map(|provider| octofwen_config::auth::default_env_var(provider, overrides.as_ref()))
        .or_else(|| {
            octofwen_config::auth::provider_env_var_for_base_url(base_url, overrides.as_ref())
        })?;
    let value = safe_env::var(env_var).ok()?;
    non_empty_key(&value)
}

fn key_file_api_key(base_url: &str) -> Option<String> {
    let contents = std::fs::read_to_string(octofwen_config::paths::default_key_file()).ok()?;
    octofwen_config::auth::parse_api_key_map(&contents)
        .into_iter()
        .find_map(|(key_base_url, api_key)| {
            octofwen_config::models::base_urls_match(&key_base_url, base_url).then_some(api_key)
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
                octofwen_config::models::base_urls_match(model_base_url, base_url)
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
            let value = safe_env::var(name).ok()?;
            non_empty_key(&value)
        }
        "command" => command_auth_api_key(auth),
        _ => None,
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
            stdout.take(octofwen_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES as u64 + 1);
        let mut buffer = Vec::new();
        let _ = limited.read_to_end(&mut buffer);
        let _ = sender.send(buffer);
    });
    let deadline =
        Instant::now() + Duration::from_millis(octofwen_config::auth::AUTH_COMMAND_TIMEOUT_MS);
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
                if output.len() > octofwen_config::auth::AUTH_COMMAND_MAX_OUTPUT_BYTES {
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
        let env_restore = SafeEnvRestore::set("OCTOFWEN_AUTOFIX_KEY_TEST", " env-key \n");
        let direct = json!({ "apiKey": " direct-key \n" });
        let env_auth = json!({
            "auth": { "type": "env", "name": "OCTOFWEN_AUTOFIX_KEY_TEST" }
        });
        let api_env_var = json!({ "apiEnvVar": "OCTOFWEN_AUTOFIX_KEY_TEST" });

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
        let env_restore = SafeEnvRestore::set("OCTOFWEN_AUTOFIX_BLANK_KEY_TEST", " \n");
        let direct = json!({ "apiKey": " \n" });
        let env_auth = json!({
            "auth": { "type": "env", "name": "OCTOFWEN_AUTOFIX_BLANK_KEY_TEST" }
        });

        assert_eq!(autofix_api_key(direct.as_object().unwrap()), None);
        if env_restore.is_some() {
            assert_eq!(autofix_api_key(env_auth.as_object().unwrap()), None);
        }
    }
}
