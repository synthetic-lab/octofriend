use crate::providers::value::sorted_json_value_string;
use serde_json::Value;

pub(crate) fn redacted_openai_curl(base_url: &str, path: &str, request_body: &Value) -> String {
    let url = openai_endpoint_url(base_url, path);
    format!(
        "curl -X POST '{url}' \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer [REDACTED_API_KEY]\" \\\n  -d @- <<'JSON'\n{}\nJSON",
        sorted_json_value_string(request_body)
    )
}

pub(crate) fn openai_endpoint_url(base_url: &str, path: &str) -> String {
    format!("{}/{}", base_url.trim_end_matches('/'), path)
}
