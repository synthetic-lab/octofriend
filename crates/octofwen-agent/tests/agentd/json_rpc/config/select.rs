use octofwen_agent::runtime::{AGENTD_CONFIG_SELECT_MODEL_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn config_select_model_uses_model_selection() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-select-model-1",
        "method": AGENTD_CONFIG_SELECT_MODEL_METHOD,
        "params": {
            "config": {
                "models": [
                    {
                        "nickname": "default",
                        "baseUrl": "https://api.openai.com/v1",
                        "model": "gpt-5-mini",
                        "context": 200000
                    },
                    {
                        "nickname": "chosen",
                        "baseUrl": "https://api.anthropic.com",
                        "model": "claude-opus-4-5",
                        "context": 200000
                    }
                ]
            },
            "modelOverride": "chosen"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["result"]["model"]["nickname"], "chosen");

    let missing_line = json!({
        "jsonrpc": "2.0",
        "id": "config-select-model-2",
        "method": AGENTD_CONFIG_SELECT_MODEL_METHOD,
        "params": {
            "config": {
                "models": [
                    {
                        "nickname": "default",
                        "baseUrl": "https://api.openai.com/v1",
                        "model": "gpt-5-mini",
                        "context": 200000
                    }
                ]
            },
            "modelOverride": "missing"
        }
    })
    .to_string();
    let missing_response =
        handle_agentd_json_rpc_line(&missing_line).expect("request should produce response");
    let missing_value: serde_json::Value =
        serde_json::from_str(&missing_response).expect("response should be json");
    assert_eq!(missing_value["result"]["model"]["nickname"], "default");
}

#[test]
fn config_select_model_reports_missing_configured_env_auth() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-select-model-missing-auth",
        "method": AGENTD_CONFIG_SELECT_MODEL_METHOD,
        "params": {
            "config": {
                "models": [
                    {
                        "nickname": "default",
                        "baseUrl": "https://api.openai.com/v1",
                        "model": "gpt-5-mini",
                        "context": 200000
                    },
                    {
                        "nickname": "chosen",
                        "baseUrl": "https://api.example.invalid/v1",
                        "apiEnvVar": "OCTOFWEN_MISSING_SWITCH_KEY_DO_NOT_SET",
                        "model": "custom-model",
                        "context": 200000
                    }
                ]
            },
            "modelOverride": "chosen"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-select-model-missing-auth");
    assert_eq!(value["result"]["model"]["nickname"], "chosen");
    assert_eq!(
        value["result"]["keyResult"],
        json!({
            "ok": false,
            "error": {
                "type": "missing",
                "message": "Environment variable OCTOFWEN_MISSING_SWITCH_KEY_DO_NOT_SET is not set"
            }
        })
    );
}
