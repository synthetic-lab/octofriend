use super::quota::quota_json;
use octofriend_models::providers::synthetic::parse_quota_json;
use octofriend_wire::json_rpc::{JsonRpcId, create_json_rpc_error, create_json_rpc_success};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;

const INVALID_PARAMS: i64 = -32602;
const SYNTHETIC_QUOTA_URL: &str = "https://api.synthetic.new/v2/quotas";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyntheticQuotaFetchParams {
    #[serde(rename = "apiKey")]
    api_key: String,
}

pub(super) fn synthetic_quota_fetch_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofriend_wire::json_rpc::JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<SyntheticQuotaFetchParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    if params.api_key.is_empty() {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    }

    create_json_rpc_success(
        id,
        json!({ "quota": fetch_synthetic_quota(&params.api_key) }),
    )
}

fn fetch_synthetic_quota(api_key: &str) -> Option<Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .ok()?;
    let response = client
        .get(SYNTHETIC_QUOTA_URL)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(
            reqwest::header::USER_AGENT,
            concat!("octofriend/", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = response.text().ok()?;
    parse_quota_json(&body).map(quota_json)
}
