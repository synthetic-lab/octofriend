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
        value["result"]["providers"]["anthropic"]["type"],
        "anthropic"
    );
    assert_eq!(value["result"]["providers"]["grok"]["shortcut"], "x");
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
        "params": { "baseUrl": "https://api.anthropic.com" }
    })
    .to_string();
    let provider_response = handle_agentd_json_rpc_line(&provider_line).expect("response");
    let provider_value: serde_json::Value = serde_json::from_str(&provider_response).expect("json");
    assert_eq!(provider_value["result"]["provider"]["name"], "Anthropic");

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
