use serde_json::{Map, Value};

pub(crate) fn json_value_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| Value::Null.to_string())
}

pub(crate) fn sorted_json_value_string(value: &Value) -> String {
    serde_json::to_string(&sorted_json_value(value)).unwrap_or_else(|_| Value::Null.to_string())
}

fn sorted_json_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(sorted_json_value).collect()),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut sorted = Map::new();
            for key in keys {
                if let Some(value) = object.get(key) {
                    sorted.insert(key.clone(), sorted_json_value(value));
                }
            }
            Value::Object(sorted)
        }
        _ => value.clone(),
    }
}

pub(crate) fn empty_json_object_string() -> String {
    "{}".into()
}

pub(crate) fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}
