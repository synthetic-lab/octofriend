use std::collections::BTreeMap;

use serde_json::Value;

pub(super) type ApiKeyOverrideMap = BTreeMap<String, String>;

pub(super) fn default_overrides(config: &Value) -> ApiKeyOverrideMap {
    config
        .get("defaultApiKeyOverrides")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    let value = value.as_str()?.trim();
                    if value.is_empty() {
                        None
                    } else {
                        Some((key.clone(), value.into()))
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}
