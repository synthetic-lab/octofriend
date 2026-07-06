use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderToolDefinition {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderToolDefinitionTarget {
    OpenAiChatCompletions,
    OpenAiResponses,
    Anthropic,
    Gemini,
}

pub fn provider_tool_definitions_json(
    target: ProviderToolDefinitionTarget,
    tools: Option<Vec<ProviderToolDefinition>>,
) -> Option<Value> {
    let tools = tools?;
    if tools.is_empty() {
        return None;
    }

    if target == ProviderToolDefinitionTarget::Gemini {
        return Some(json!([{
            "functionDeclarations": tools
                .into_iter()
                .map(gemini_function_declaration_json)
                .collect::<Vec<_>>(),
        }]));
    }

    Some(Value::Array(
        tools
            .into_iter()
            .map(|tool| provider_tool_definition_json(target, tool))
            .collect(),
    ))
}

fn provider_tool_definition_json(
    target: ProviderToolDefinitionTarget,
    tool: ProviderToolDefinition,
) -> Value {
    match target {
        ProviderToolDefinitionTarget::OpenAiChatCompletions => json!({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": cleaned_schema(tool.schema),
                "strict": true,
            },
        }),
        ProviderToolDefinitionTarget::OpenAiResponses => json!({
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": openai_strict_schema(tool.schema),
            "strict": true,
        }),
        ProviderToolDefinitionTarget::Anthropic => json!({
            "name": tool.name,
            "description": tool.description,
            "input_schema": cleaned_schema(tool.schema),
        }),
        ProviderToolDefinitionTarget::Gemini => gemini_function_declaration_json(tool),
    }
}

fn gemini_function_declaration_json(tool: ProviderToolDefinition) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "parametersJsonSchema": cleaned_schema(tool.schema),
    })
}

fn cleaned_schema(mut schema: Value) -> Value {
    remove_schema_metadata(&mut schema);
    schema
}

fn openai_strict_schema(mut schema: Value) -> Value {
    remove_schema_metadata(&mut schema);
    lower_to_openai_strict_schema(&mut schema);
    schema
}

fn remove_schema_metadata(schema: &mut Value) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    object.remove("$schema");
    object.remove("description");
    object.remove("title");
}

fn lower_to_openai_strict_schema(schema: &mut Value) {
    match schema {
        Value::Array(items) => {
            for item in items {
                lower_to_openai_strict_schema(item);
            }
        }
        Value::Object(object) => {
            add_openai_strict_type_hints(object);
            lower_properties_into_openai_strict_schema(object);
            lower_nested_openai_strict_schema_values(object);
        }
        _ => {}
    }
}

fn lower_properties_into_openai_strict_schema(node: &mut Map<String, Value>) {
    let required = node
        .get("required")
        .and_then(Value::as_array)
        .map(|required| {
            required
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();

    let Some(Value::Object(properties)) = node.get_mut("properties") else {
        return;
    };
    let property_names = properties.keys().cloned().collect::<Vec<_>>();

    for property_name in &property_names {
        let Some(property_schema) = properties.get_mut(property_name) else {
            continue;
        };
        lower_to_openai_strict_schema(property_schema);
        if !required.contains(property_name) {
            *property_schema = nullable_schema(property_schema.clone());
        }
    }

    node.insert(
        "required".into(),
        Value::Array(property_names.into_iter().map(Value::String).collect()),
    );
    node.entry("additionalProperties")
        .or_insert(Value::Bool(false));
}

fn lower_nested_openai_strict_schema_values(node: &mut Map<String, Value>) {
    for (key, value) in node {
        if key == "properties" || key == "required" {
            continue;
        }
        lower_to_openai_strict_schema(value);
    }
}

fn add_openai_strict_type_hints(node: &mut Map<String, Value>) {
    if node.contains_key("type") {
        return;
    }

    if let Some(Value::Array(enum_values)) = node.get("enum") {
        let non_null_values = enum_values
            .iter()
            .filter(|value| !value.is_null())
            .collect::<Vec<_>>();
        if !non_null_values.is_empty() && non_null_values.iter().all(|value| value.is_string()) {
            let type_value = if enum_values.iter().any(Value::is_null) {
                Value::Array(vec![
                    Value::String("string".into()),
                    Value::String("null".into()),
                ])
            } else {
                Value::String("string".into())
            };
            node.insert("type".into(), type_value);
            return;
        }
    }

    if node.get("const").is_some_and(Value::is_string) {
        node.insert("type".into(), Value::String("string".into()));
    }
}

fn nullable_schema(schema: Value) -> Value {
    let Value::Object(mut node) = schema else {
        return json!({ "anyOf": [schema, { "type": "null" }] });
    };

    match node.get("type") {
        Some(Value::String(type_name)) if type_name == "null" => return Value::Object(node),
        Some(Value::String(type_name)) => {
            let type_name = type_name.clone();
            node.insert(
                "type".into(),
                Value::Array(vec![Value::String(type_name), Value::String("null".into())]),
            );
            return Value::Object(node);
        }
        Some(Value::Array(types)) => {
            if types.iter().any(|value| value.as_str() == Some("null")) {
                return Value::Object(node);
            }
            let mut types = types.clone();
            types.push(Value::String("null".into()));
            node.insert("type".into(), Value::Array(types));
            return Value::Object(node);
        }
        _ => {}
    }

    if let Some(Value::Array(any_of)) = node.get("anyOf") {
        if any_of.iter().any(is_null_schema) {
            return Value::Object(node);
        }
        let mut any_of = any_of.clone();
        any_of.push(json!({ "type": "null" }));
        node.insert("anyOf".into(), Value::Array(any_of));
        return Value::Object(node);
    }

    json!({ "anyOf": [Value::Object(node), { "type": "null" }] })
}

fn is_null_schema(schema: &Value) -> bool {
    schema
        .as_object()
        .and_then(|object| object.get("type"))
        .and_then(Value::as_str)
        == Some("null")
}
