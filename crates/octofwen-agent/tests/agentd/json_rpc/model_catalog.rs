use octofwen_agent::agentd::{
    AGENTD_MODEL_PROVIDER_CATALOG_METHOD, AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD,
    AGENTD_MODEL_PROVIDER_KEY_FROM_NAME_METHOD, AGENTD_MODEL_RECOMMENDED_MODEL_METHOD,
    handle_agentd_json_rpc_line,
};
use serde_json::json;

#[test]
fn model_provider_catalog_request_returns_agentd_provider_catalog() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "model-catalog-1",
        "method": AGENTD_MODEL_PROVIDER_CATALOG_METHOD
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "model-catalog-1");
    assert_eq!(
        value["result"]["defaultMultimodalImageModelExample"],
        "Kimi K2.5"
    );
    assert_eq!(value["result"]["syntheticProviderKey"], "synthetic");
    assert_eq!(
        value["result"]["providers"]["synthetic"],
        json!({
            "shortcut": "s",
            "type": "standard",
            "name": "Synthetic",
            "envVar": "SYNTHETIC_API_KEY",
            "baseUrl": "https://api.synthetic.new/v1",
            "baseUrlAliases": [
                "https://api.synthetic.new/openai/v1",
                "https://synthetic.new/api/openai/v1",
                "https://api.glhf.chat/v1",
                "https://glhf.chat/api/v1",
                "https://glhf.chat/api/openai/v1"
            ],
            "apiKeyUrl": "https://dev.synthetic.new/",
            "authMethods": ["api-key"],
            "models": [
                {
                    "model": "hf:moonshotai/Kimi-K2.5",
                    "nickname": "Kimi K2.5",
                    "context": 262144,
                    "modalities": {
                        "image": {
                            "enabled": true,
                            "maxSizeMB": 10,
                            "acceptedMimeTypes": [
                                "image/jpeg",
                                "image/png",
                                "image/webp",
                                "image/gif"
                            ]
                        }
                    }
                },
                {
                    "model": "hf:MiniMaxAI/MiniMax-M2.5",
                    "nickname": "MiniMax M2.5",
                    "context": 196608
                },
                {
                    "model": "hf:zai-org/GLM-4.7",
                    "nickname": "GLM-4.7",
                    "context": 202752
                }
            ],
            "testModel": "hf:MiniMaxAI/MiniMax-M2.1"
        })
    );
    assert_eq!(
        value["result"]["providers"]["openai"]["type"],
        "openai-responses"
    );
    assert_eq!(
        value["result"]["providers"]["openai"]["apiKeyUrl"],
        "https://platform.openai.com/api-keys"
    );
    assert_eq!(
        value["result"]["providers"]["openai"]["baseUrlAliases"],
        json!([])
    );
    assert_eq!(
        value["result"]["providers"]["openai"]["authMethods"],
        json!(["chatgpt-oauth", "api-key"])
    );
    assert_eq!(
        value["result"]["providers"]["anthropic"]["type"],
        "anthropic"
    );
    assert_eq!(
        value["result"]["providers"]["anthropic"]["apiKeyUrl"],
        "https://console.anthropic.com/settings/keys"
    );
    assert_eq!(
        value["result"]["providers"]["anthropic"]["authMethods"],
        json!(["api-key"])
    );
    assert_eq!(value["result"]["providers"]["gemini"]["type"], "gemini");
    assert_eq!(
        value["result"]["providers"]["gemini"]["envVar"],
        "GEMINI_API_KEY"
    );
    assert_eq!(
        value["result"]["providers"]["gemini"]["baseUrl"],
        "https://generativelanguage.googleapis.com/v1beta"
    );
    assert_eq!(
        value["result"]["providers"]["gemini"]["baseUrlAliases"],
        json!([])
    );
    assert_eq!(
        value["result"]["providers"]["gemini"]["apiKeyUrl"],
        "https://aistudio.google.com/apikey"
    );
    assert_eq!(
        value["result"]["providers"]["gemini"]["authMethods"],
        json!(["api-key"])
    );
    assert_eq!(
        value["result"]["providers"]["gemini"]["testModel"],
        "gemini-3.5-flash"
    );
    assert_eq!(value["result"]["providers"]["grok"]["shortcut"], "x");
    assert_eq!(
        value["result"]["providers"]["grok"]["apiKeyUrl"],
        "https://console.x.ai/"
    );
}

#[test]
fn model_provider_lookup_requests_are_agentd() {
    let key_line = json!({
        "jsonrpc": "2.0",
        "id": "model-key-1",
        "method": AGENTD_MODEL_PROVIDER_KEY_FROM_NAME_METHOD,
        "params": { "name": "OpenAI" }
    })
    .to_string();
    let key_response = handle_agentd_json_rpc_line(&key_line).expect("response");
    let key_value: serde_json::Value = serde_json::from_str(&key_response).expect("json");
    assert_eq!(key_value["result"]["key"], "openai");

    let provider_line = json!({
        "jsonrpc": "2.0",
        "id": "model-provider-1",
        "method": AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD,
        "params": { "baseUrl": " https://api.anthropic.com/ " }
    })
    .to_string();
    let provider_response = handle_agentd_json_rpc_line(&provider_line).expect("response");
    let provider_value: serde_json::Value = serde_json::from_str(&provider_response).expect("json");
    assert_eq!(provider_value["result"]["provider"]["name"], "Anthropic");

    let gemini_provider_line = json!({
        "jsonrpc": "2.0",
        "id": "model-provider-gemini",
        "method": AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD,
        "params": { "baseUrl": "https://generativelanguage.googleapis.com/v1beta" }
    })
    .to_string();
    let gemini_provider_response =
        handle_agentd_json_rpc_line(&gemini_provider_line).expect("response");
    let gemini_provider_value: serde_json::Value =
        serde_json::from_str(&gemini_provider_response).expect("json");
    assert_eq!(
        gemini_provider_value["result"]["provider"]["name"],
        "Google Gemini"
    );

    let legacy_synthetic_provider_line = json!({
        "jsonrpc": "2.0",
        "id": "model-provider-legacy-synthetic",
        "method": AGENTD_MODEL_PROVIDER_FOR_BASE_URL_METHOD,
        "params": { "baseUrl": "https://api.synthetic.new/openai/v1" }
    })
    .to_string();
    let legacy_synthetic_provider_response =
        handle_agentd_json_rpc_line(&legacy_synthetic_provider_line).expect("response");
    let legacy_synthetic_provider_value: serde_json::Value =
        serde_json::from_str(&legacy_synthetic_provider_response).expect("json");
    assert_eq!(
        legacy_synthetic_provider_value["result"]["provider"]["name"],
        "Synthetic"
    );

    let recommended_line = json!({
        "jsonrpc": "2.0",
        "id": "model-recommended-1",
        "method": AGENTD_MODEL_RECOMMENDED_MODEL_METHOD,
        "params": { "provider": "synthetic" }
    })
    .to_string();
    let recommended_response = handle_agentd_json_rpc_line(&recommended_line).expect("response");
    let recommended_value: serde_json::Value =
        serde_json::from_str(&recommended_response).expect("json");
    assert_eq!(
        recommended_value["result"]["model"]["nickname"],
        "Kimi K2.5"
    );
}
