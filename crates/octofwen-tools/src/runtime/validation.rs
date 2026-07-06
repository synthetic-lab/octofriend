use serde_json::Value;

use crate::runtime::builder::ToolDefinition;

pub fn validate_tool_arguments(
    definition: &ToolDefinition,
    arguments: &Value,
) -> Result<(), String> {
    validate_json_schema_arguments(&definition.arguments_schema, arguments)
}

pub fn validate_json_schema_arguments(schema: &Value, arguments: &Value) -> Result<(), String> {
    if !schema.is_object() {
        return Ok(());
    }
    if schema.get("type").and_then(Value::as_str) == Some("object") && !arguments.is_object() {
        return Err("tool arguments must be an object".into());
    }
    let Some(object) = arguments.as_object() else {
        return Ok(());
    };

    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for key in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(key) {
                return Err(format!("missing required tool argument {key}"));
            }
        }
    }

    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return Ok(());
    };
    for (key, property_schema) in properties {
        let Some(value) = object.get(key) else {
            continue;
        };
        validate_property_type(key, property_schema, value)?;
    }
    Ok(())
}

fn validate_property_type(key: &str, schema: &Value, value: &Value) -> Result<(), String> {
    let Some(schema_type) = schema.get("type").and_then(Value::as_str) else {
        return Ok(());
    };
    let valid = match schema_type {
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "boolean" => value.is_boolean(),
        "object" => value.is_object(),
        "array" => value.is_array(),
        _ => true,
    };
    if valid {
        return Ok(());
    }
    Err(format!("tool argument {key} must be a {schema_type}"))
}
