use octofwen_config::models::{PROVIDERS, ProviderConfig, ProviderKey, ProviderKind};
use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderNameParams {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderBaseUrlParams {
    #[serde(rename = "baseUrl")]
    base_url: String,
}

#[derive(Debug, Deserialize)]
struct RecommendedModelParams {
    provider: String,
}

pub(in crate::agentd) fn model_provider_catalog_response(id: JsonRpcId) -> JsonRpcResponse {
    create_json_rpc_success(id, model_provider_catalog_result_json())
}

pub(in crate::agentd) fn model_provider_key_from_name_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ProviderNameParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    match octofwen_config::models::key_from_name(&params.name) {
        Ok(key) => create_json_rpc_success(id, json!({ "key": key.as_config_key() })),
        Err(error) => create_json_rpc_error(id, INVALID_PARAMS, error.to_string(), None),
    }
}

pub(in crate::agentd) fn model_provider_for_base_url_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ProviderBaseUrlParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    create_json_rpc_success(
        id,
        json!({ "provider": octofwen_config::models::provider_for_base_url(&params.base_url).map(provider_json) }),
    )
}

pub(in crate::agentd) fn model_recommended_model_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<RecommendedModelParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Some(provider) = provider_for_key(&params.provider) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid provider", None);
    };
    let model = octofwen_config::models::recommended_model(provider.key);
    create_json_rpc_success(id, json!({ "model": model_json(model) }))
}

fn model_provider_catalog_result_json() -> Value {
    let mut providers = Map::new();
    for provider in PROVIDERS {
        providers.insert(provider.key.as_config_key().into(), provider_json(provider));
    }

    json!({
        "providers": providers,
        "syntheticProviderKey": ProviderKey::Synthetic.as_config_key(),
        "defaultMultimodalImageModelExample": octofwen_config::models::DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
    })
}

fn provider_json(provider: &ProviderConfig) -> Value {
    json!({
        "shortcut": provider.shortcut.to_string(),
        "type": provider_kind_json(provider.kind),
        "name": provider.name,
        "envVar": provider.env_var,
        "baseUrl": provider.base_url,
        "apiKeyUrl": provider.api_key_url,
        "models": provider.models.iter().map(model_json).collect::<Vec<_>>(),
        "testModel": provider.test_model,
    })
}

fn model_json(model: &octofwen_config::models::ProviderModelConfig) -> Value {
    let mut object = Map::new();
    object.insert("model".into(), json!(model.model));
    object.insert("nickname".into(), json!(model.nickname));
    object.insert("context".into(), json!(model.context));
    if let Some(reasoning) = model.reasoning {
        object.insert(
            "reasoning".into(),
            json!(match reasoning {
                octofwen_config::models::ReasoningLevel::None => "none",
                octofwen_config::models::ReasoningLevel::Minimal => "minimal",
                octofwen_config::models::ReasoningLevel::Low => "low",
                octofwen_config::models::ReasoningLevel::Medium => "medium",
                octofwen_config::models::ReasoningLevel::High => "high",
                octofwen_config::models::ReasoningLevel::XHigh => "xhigh",
            }),
        );
    }
    if let Some(modalities) = model.modalities {
        object.insert(
            "modalities".into(),
            json!({
                "image": modalities.image.map(|image| json!({
                    "enabled": image.enabled,
                    "maxSizeMB": image.max_size_mb,
                    "acceptedMimeTypes": image.accepted_mime_types,
                })),
            }),
        );
    }
    Value::Object(object)
}

fn provider_for_key(key: &str) -> Option<&'static ProviderConfig> {
    PROVIDERS
        .iter()
        .find(|provider| provider.key.as_config_key() == key)
}

fn provider_kind_json(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Standard => "standard",
        ProviderKind::OpenAiResponses => "openai-responses",
        ProviderKind::Anthropic => "anthropic",
        ProviderKind::Gemini => "gemini",
    }
}
