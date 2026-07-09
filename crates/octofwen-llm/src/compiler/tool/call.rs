use serde_json::Value;

type OptionalPropertyPaths = Vec<Vec<String>>;

const INVALID_JSON_MESSAGE: &str = "Syntax error: invalid JSON in tool call arguments";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolCallPreparseInput {
    pub tool_call_id: String,
    pub tool_name: String,
    pub args: Value,
    pub available_tool_names: Vec<String>,
    pub autofixed_args: Option<Value>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ToolCallPreparseResult {
    Ready {
        tool_call_id: String,
        tool_name: String,
        args: Value,
    },
    NeedsAutofix {
        bad_json: String,
        message: String,
    },
    Error {
        message: String,
    },
}

pub fn preparse_tool_call(input: &ToolCallPreparseInput) -> ToolCallPreparseResult {
    if !input
        .available_tool_names
        .iter()
        .any(|name| name == &input.tool_name)
    {
        return ToolCallPreparseResult::Error {
            message: unknown_tool_message(&input.tool_name, &input.available_tool_names),
        };
    }

    let args = match &input.args {
        Value::String(raw_args) => preparse_string_args(raw_args, input.autofixed_args.as_ref()),
        value => Ok(value.clone()),
    };

    match args {
        Ok(args) => ToolCallPreparseResult::Ready {
            tool_call_id: input.tool_call_id.clone(),
            tool_name: input.tool_name.clone(),
            args,
        },
        Err(bad_json) => ToolCallPreparseResult::NeedsAutofix {
            bad_json,
            message: INVALID_JSON_MESSAGE.into(),
        },
    }
}

fn preparse_string_args(raw_args: &str, autofixed_args: Option<&Value>) -> Result<Value, String> {
    let source = if raw_args.is_empty() { "{}" } else { raw_args };
    let Ok(parsed) = serde_json::from_str::<Value>(source) else {
        if let Some(autofixed_args) = autofixed_args {
            return Ok(autofixed_args.clone());
        }
        return Err(source.into());
    };

    Ok(match parsed {
        Value::String(inner) => match serde_json::from_str::<Value>(&inner) {
            Ok(inner_parsed) => inner_parsed,
            Err(_) => Value::String(inner),
        },
        parsed => parsed,
    })
}

fn unknown_tool_message(tool_name: &str, available_tool_names: &[String]) -> String {
    format!(
        "Unknown tool {tool_name}. The only valid tool names are:\n\n- {}\n\nPlease try calling a valid tool.",
        available_tool_names.join("\n- ")
    )
}

pub fn normalize_openai_strict_function_arguments(schema: &Value, args: &Value) -> Value {
    let mut optional_paths = Vec::new();
    collect_optional_property_paths(schema, Vec::new(), &mut optional_paths);
    delete_null_optionals(args.clone(), &optional_paths)
}

fn collect_optional_property_paths(
    schema: &Value,
    path: Vec<String>,
    optional_paths: &mut OptionalPropertyPaths,
) {
    match schema {
        Value::Array(items) => {
            for item in items {
                collect_optional_property_paths(item, path.clone(), optional_paths);
            }
        }
        Value::Object(object) => {
            collect_object_optional_property_paths(object, &path, optional_paths);
            for (key, value) in object {
                if key == "properties" || key == "required" {
                    continue;
                }
                collect_optional_property_paths(value, path.clone(), optional_paths);
            }
        }
        _ => {}
    }
}

fn collect_object_optional_property_paths(
    schema: &serde_json::Map<String, Value>,
    path: &[String],
    optional_paths: &mut OptionalPropertyPaths,
) {
    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return;
    };
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|required| {
            required
                .iter()
                .filter_map(Value::as_str)
                .collect::<std::collections::BTreeSet<_>>()
        })
        .unwrap_or_default();

    for (property_name, property_schema) in properties {
        let mut property_path = path.to_vec();
        property_path.push(property_name.clone());
        if !required.contains(property_name.as_str()) {
            optional_paths.push(property_path.clone());
        }
        collect_optional_property_paths(property_schema, property_path, optional_paths);
    }
}

fn delete_null_optionals(mut args: Value, optional_paths: &[Vec<String>]) -> Value {
    if !args.is_object() {
        return args;
    }
    for path in optional_paths {
        delete_if_null_at_path(&mut args, path);
    }
    args
}

fn delete_if_null_at_path(value: &mut Value, path: &[String]) {
    if path.is_empty() {
        return;
    }
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let key = &path[0];
    if path.len() == 1 {
        if object.get(key).is_some_and(Value::is_null) {
            object.remove(key);
        }
        return;
    }
    if let Some(next) = object.get_mut(key) {
        delete_if_null_at_path(next, &path[1..]);
    }
}
