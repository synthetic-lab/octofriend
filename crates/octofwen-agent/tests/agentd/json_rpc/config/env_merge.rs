use octofwen_agent::agentd::{
    AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD, AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
    handle_agentd_json_rpc_line,
};
use serde_json::json;

#[test]
fn config_merge_env_var_uses_provider_defaults() {
    let model = json!({
        "nickname": "GPT-5 Mini",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-5-mini",
        "context": 200000
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-env-1",
        "method": AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
        "params": {
            "config": { "yourName": "Ada", "models": [model.clone()] },
            "model": model,
            "apiEnvVar": "CUSTOM_OPENAI_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["defaultApiKeyOverrides"]["openai"],
        "CUSTOM_OPENAI_KEY"
    );
    assert!(
        value["result"]["config"]["models"][0]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_merge_env_var_writes_structured_auth_for_custom_base_urls() {
    let model = json!({
        "nickname": "Custom",
        "baseUrl": "https://custom.invalid/v1",
        "model": "custom-model",
        "context": 128000
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-env-custom",
        "method": AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
        "params": {
            "config": { "yourName": "Ada", "models": [model.clone()] },
            "model": model,
            "apiEnvVar": "CUSTOM_MODEL_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["models"][0]["auth"],
        json!({ "type": "env", "name": "CUSTOM_MODEL_KEY", "credential": "api-key" })
    );
    assert!(
        value["result"]["config"]["models"][0]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_merge_env_var_uses_provider_type_for_local_proxy_base_urls() {
    let model = json!({
        "nickname": "Local Anthropic",
        "type": "anthropic",
        "baseUrl": "http://127.0.0.1:8080",
        "model": "claude-sonnet-5",
        "context": 200000
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-env-local-provider-type",
        "method": AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
        "params": {
            "config": { "yourName": "Ada", "models": [model.clone()] },
            "model": model,
            "apiEnvVar": "CUSTOM_ANTHROPIC_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["defaultApiKeyOverrides"]["anthropic"],
        "CUSTOM_ANTHROPIC_KEY"
    );
    assert!(
        value["result"]["config"]["models"][0]
            .get("apiEnvVar")
            .is_none()
    );
    assert!(value["result"]["config"]["models"][0].get("auth").is_none());
}

#[test]
fn config_merge_env_var_trims_and_clears_stale_provider_model_auth() {
    let model = json!({
        "nickname": "Local Anthropic",
        "type": "anthropic",
        "baseUrl": "http://127.0.0.1:8080",
        "auth": { "type": "env", "name": "OLD_ANTHROPIC_KEY", "credential": "api-key" },
        "apiEnvVar": "OLD_ANTHROPIC_KEY",
        "model": "claude-sonnet-5",
        "context": 200000
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-env-clears-stale-auth",
        "method": AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
        "params": {
            "config": { "yourName": "Ada", "models": [model.clone()] },
            "model": model,
            "apiEnvVar": " CUSTOM_ANTHROPIC_KEY "
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["defaultApiKeyOverrides"]["anthropic"],
        "CUSTOM_ANTHROPIC_KEY"
    );
    assert!(value["result"]["config"]["models"][0].get("auth").is_none());
    assert!(
        value["result"]["config"]["models"][0]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_merge_autofix_env_var_clears_stale_provider_auth_when_default_matches() {
    let model = json!({
        "type": "synthetic",
        "baseUrl": "https://api.synthetic.new/v1",
        "auth": { "type": "env", "name": "OLD_SYNTHETIC_KEY", "credential": "api-key" },
        "apiEnvVar": "OLD_SYNTHETIC_KEY",
        "model": "hf:syntheticlab/fix-json"
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-autofix-clears-stale-auth",
        "method": AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD,
        "params": {
            "config": {
                "yourName": "Ada",
                "models": [],
                "defaultApiKeyOverrides": { "synthetic": "SYNTHETIC_API_KEY" },
                "fixJson": model.clone()
            },
            "key": "fixJson",
            "model": model,
            "apiEnvVar": " SYNTHETIC_API_KEY "
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert!(value["result"]["config"]["fixJson"].get("auth").is_none());
    assert!(
        value["result"]["config"]["fixJson"]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_merge_autofix_env_var_uses_provider_defaults() {
    let model = json!({
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-5-mini"
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-autofix-env-1",
        "method": AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD,
        "params": {
            "config": {
                "yourName": "Ada",
                "models": [],
                "fixJson": model.clone()
            },
            "key": "fixJson",
            "model": model,
            "apiEnvVar": "CUSTOM_OPENAI_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["defaultApiKeyOverrides"]["openai"],
        "CUSTOM_OPENAI_KEY"
    );
    assert!(
        value["result"]["config"]["fixJson"]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_merge_autofix_env_var_uses_provider_type_for_local_proxy_base_urls() {
    let model = json!({
        "type": "gemini",
        "baseUrl": "http://127.0.0.1:8080/v1beta",
        "model": "gemini-3.5-flash"
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-autofix-env-local-provider-type",
        "method": AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD,
        "params": {
            "config": {
                "yourName": "Ada",
                "models": [],
                "fixJson": model.clone()
            },
            "key": "fixJson",
            "model": model,
            "apiEnvVar": "CUSTOM_GEMINI_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["defaultApiKeyOverrides"]["gemini"],
        "CUSTOM_GEMINI_KEY"
    );
    assert!(
        value["result"]["config"]["fixJson"]
            .get("apiEnvVar")
            .is_none()
    );
    assert!(value["result"]["config"]["fixJson"].get("auth").is_none());
}

#[test]
fn config_merge_autofix_env_var_writes_structured_auth_for_custom_base_urls() {
    let model = json!({
        "baseUrl": "https://custom.invalid/v1",
        "model": "custom-fix-json"
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-autofix-env-custom",
        "method": AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD,
        "params": {
            "config": {
                "yourName": "Ada",
                "models": [],
                "fixJson": model.clone()
            },
            "key": "fixJson",
            "model": model,
            "apiEnvVar": "CUSTOM_FIX_JSON_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["fixJson"]["auth"],
        json!({ "type": "env", "name": "CUSTOM_FIX_JSON_KEY", "credential": "api-key" })
    );
    assert!(
        value["result"]["config"]["fixJson"]
            .get("apiEnvVar")
            .is_none()
    );
}
