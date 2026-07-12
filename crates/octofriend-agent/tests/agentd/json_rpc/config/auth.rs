use octofriend_agent::runtime::handle_agentd_json_rpc_line;
use serde_json::json;

use env as safe_env;

use super::echo_command;

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
fn config_key_for_model_runs_agentd_command_auth() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-1",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "baseUrl": "https://api.example.invalid/v1",
                "auth": { "type": "command", "command": echo_command("model-key") }
            },
            "config": null
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-1");
    assert_eq!(
        value["result"]["result"],
        json!({ "ok": true, "key": "model-key" })
    );
}

#[test]
fn config_key_for_model_rejects_invalid_explicit_env_auth_without_fallback() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-invalid-env-auth",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "type": "openai-responses",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "auth": { "type": "env" }
            },
            "config": {
                "defaultApiKeyOverrides": {
                    "openai": "PATH"
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-invalid-env-auth");
    assert_eq!(
        value["result"]["result"],
        json!({
            "ok": false,
            "error": {
                "type": "invalid",
                "message": "Environment auth name is missing"
            }
        })
    );
}

#[test]
fn config_key_for_model_rejects_blank_explicit_env_auth_without_fallback() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-blank-env-auth",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "type": "openai-responses",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "auth": { "type": "env", "name": "  " }
            },
            "config": {
                "defaultApiKeyOverrides": {
                    "openai": "PATH"
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-blank-env-auth");
    assert_eq!(
        value["result"]["result"],
        json!({
            "ok": false,
            "error": {
                "type": "invalid",
                "message": "Environment auth name is missing"
            }
        })
    );
}

#[test]
fn config_key_for_model_rejects_non_string_command_auth_args_without_dropping_them() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-command-non-string-arg",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "baseUrl": "https://api.example.invalid/v1",
                "auth": { "type": "command", "command": ["printf", 42] }
            },
            "config": null
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-command-non-string-arg");
    assert_eq!(
        value["result"]["result"],
        json!({
            "ok": false,
            "error": {
                "type": "invalid",
                "message": "Auth command arguments must be strings"
            }
        })
    );
}

#[test]
fn config_key_for_model_rejects_chatgpt_oauth_for_non_openai_provider() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-anthropic-oauth",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "baseUrl": "http://127.0.0.1:8080",
                "type": "anthropic",
                "auth": {
                    "type": "env",
                    "name": "PATH",
                    "credential": "chatgpt-oauth"
                }
            },
            "config": null
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-anthropic-oauth");
    assert_eq!(
        value["result"]["result"],
        json!({
            "ok": false,
            "error": {
                "type": "invalid",
                "message": "ChatGPT OAuth is only supported for OpenAI providers."
            }
        })
    );
}

#[test]
fn config_key_for_model_allows_chatgpt_oauth_for_openai_provider() {
    let path_key = safe_env::var("PATH").expect("PATH should be available for this test");
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-openai-oauth",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "baseUrl": "http://127.0.0.1:8080/v1",
                "type": "openai-responses",
                "auth": {
                    "type": "env",
                    "name": "PATH",
                    "credential": "chatgpt-oauth"
                }
            },
            "config": null
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-openai-oauth");
    assert_eq!(
        value["result"]["result"],
        json!({ "ok": true, "key": format!("codex-oauth:{path_key}") })
    );
}

#[test]
fn config_key_for_model_encodes_gemini_oauth_project_and_token() {
    let path_key = safe_env::var("PATH").expect("PATH should be available for this test");
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-gemini-oauth",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
                "type": "gemini",
                "auth": {
                    "type": "env",
                    "name": "PATH",
                    "credential": "gemini-oauth",
                    "project": "example-project"
                }
            },
            "config": null
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    assert_eq!(
        value["result"]["result"],
        json!({
            "ok": true,
            "key": format!("gemini-oauth:example-project|token={path_key}")
        })
    );
}

#[test]
fn config_key_for_model_uses_provider_type_for_local_proxy_base_url() {
    let path_key = safe_env::var("PATH").expect("PATH should be available for this test");
    for (provider_key, provider_type, base_url) in [
        ("openai", "openai-responses", "http://127.0.0.1:8080/v1"),
        ("anthropic", "anthropic", "http://127.0.0.1:8080"),
        ("gemini", "gemini", "http://127.0.0.1:8080/v1beta"),
    ] {
        let line = json!({
            "jsonrpc": "2.0",
            "id": format!("config-key-model-local-proxy-{provider_key}"),
            "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
            "params": {
                "model": {
                    "baseUrl": base_url,
                    "type": provider_type
                },
                "config": {
                    "defaultApiKeyOverrides": {
                        provider_key: "PATH"
                    }
                }
            }
        })
        .to_string();

        let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
        let value: serde_json::Value =
            serde_json::from_str(&response).expect("response should be json");

        assert_eq!(
            value["id"],
            format!("config-key-model-local-proxy-{provider_key}")
        );
        assert_eq!(
            value["result"]["result"],
            json!({ "ok": true, "key": path_key })
        );
    }
}

#[test]
fn config_key_for_model_uses_known_standard_model_for_local_synthetic_proxy_base_url() {
    let path_key = safe_env::var("PATH").expect("PATH should be available for this test");
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-local-proxy-synthetic",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "baseUrl": "http://127.0.0.1:8080/v1",
                "type": "standard",
                "model": "hf:moonshotai/Kimi-K2.5"
            },
            "config": {
                "defaultApiKeyOverrides": {
                    "synthetic": "PATH"
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-local-proxy-synthetic");
    assert_eq!(
        value["result"]["result"],
        json!({ "ok": true, "key": path_key })
    );
}

#[test]
fn config_key_for_base_url_normalizes_known_provider_base_urls() {
    let path_key = safe_env::var("PATH").expect("PATH should be available for this test");
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-base-url-normalized-openai",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD,
        "params": {
            "baseUrl": " https://api.openai.com/v1/ ",
            "config": {
                "defaultApiKeyOverrides": {
                    "openai": "PATH"
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-base-url-normalized-openai");
    assert_eq!(
        value["result"]["result"],
        json!({ "ok": true, "key": path_key })
    );
}

#[test]
fn config_key_for_base_url_normalizes_configured_model_base_urls() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-base-url-normalized-config-model",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD,
        "params": {
            "baseUrl": "https://models.example.test/v1/",
            "config": {
                "models": [{
                    "baseUrl": " https://models.example.test/v1 ",
                    "auth": { "type": "command", "command": echo_command("configured-model-key") }
                }]
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-base-url-normalized-config-model");
    assert_eq!(
        value["result"]["result"],
        json!({ "ok": true, "key": "configured-model-key" })
    );
}

#[test]
fn config_key_for_legacy_synthetic_base_url_uses_synthetic_env_config() {
    let env_restore = SafeEnvRestore::set("SYNTHETIC_API_KEY", "legacy-synthetic-key");
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-base-url-legacy-synthetic",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD,
        "params": {
            "baseUrl": "https://api.synthetic.new/openai/v1",
            "config": if env_restore.is_some() {
                serde_json::Value::Null
            } else {
                json!({
                    "defaultApiKeyOverrides": {
                        "synthetic": "octofriend_LEGACY_SYNTHETIC_KEY_DO_NOT_SET"
                    }
                })
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-base-url-legacy-synthetic");
    if env_restore.is_some() {
        assert_eq!(
            value["result"]["result"],
            json!({ "ok": true, "key": "legacy-synthetic-key" })
        );
    } else {
        assert_eq!(
            value["result"]["result"],
            json!({
                "ok": false,
                "error": {
                    "type": "missing",
                    "message": "No API key found for https://api.synthetic.new/openai/v1"
                }
            })
        );
    }
}

#[test]
fn config_search_uses_agentd_search_auth() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-search-1",
        "method": octofriend_agent::runtime::AGENTD_CONFIG_SEARCH_METHOD,
        "params": {
            "config": {
                "search": {
                    "url": "https://search.example.invalid",
                    "auth": { "type": "command", "command": echo_command("search-key") }
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-search-1");
    assert_eq!(
        value["result"]["search"],
        json!({ "url": "https://search.example.invalid", "key": "search-key" })
    );
}
