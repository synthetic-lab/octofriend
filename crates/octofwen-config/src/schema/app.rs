use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigValidationError {
    message: String,
}

impl ConfigValidationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ConfigValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ConfigValidationError {}

pub type ConfigValidationResult<T> = Result<T, ConfigValidationError>;

pub fn validate_config(value: Value) -> ConfigValidationResult<Value> {
    let data = object(value, "config")?;
    assert_exact_keys(
        &data,
        &[
            "configVersion",
            "yourName",
            "models",
            "diffApply",
            "fixJson",
            "vimEmulation",
            "search",
            "defaultApiKeyOverrides",
            "mcpServers",
            "lsp",
            "skills",
            "notifications",
        ],
        "config",
    )?;
    let models = data
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| ConfigValidationError::new("Expected config.models to be an array"))?;
    let mut validated = Map::new();
    insert_optional_number(&mut validated, &data, "configVersion", "config")?;
    validated.insert(
        "yourName".into(),
        Value::String(string_field(&data, "yourName", "config")?),
    );
    validated.insert(
        "models".into(),
        Value::Array(
            models
                .iter()
                .enumerate()
                .map(|(index, model)| {
                    validate_model_config(model.clone(), &format!("config.models[{index}]"))
                })
                .collect::<ConfigValidationResult<Vec<_>>>()?,
        ),
    );
    insert_optional_value(
        &mut validated,
        &data,
        "diffApply",
        "config",
        validate_autofix_model,
    )?;
    insert_optional_value(
        &mut validated,
        &data,
        "fixJson",
        "config",
        validate_autofix_model,
    )?;
    if let Some(value) = data.get("vimEmulation") {
        let object = object(value.clone(), "config.vimEmulation")?;
        let mut vim = Map::new();
        vim.insert(
            "enabled".into(),
            Value::Bool(boolean_field(&object, "enabled", "config.vimEmulation")?),
        );
        validated.insert("vimEmulation".into(), Value::Object(vim));
    }
    insert_optional_value(&mut validated, &data, "search", "config", validate_search)?;
    if let Some(value) = data.get("defaultApiKeyOverrides") {
        validated.insert(
            "defaultApiKeyOverrides".into(),
            Value::Object(string_record(
                value.clone(),
                "config.defaultApiKeyOverrides",
            )?),
        );
    }
    if let Some(value) = data.get("mcpServers") {
        validated.insert(
            "mcpServers".into(),
            map_record(value.clone(), "config.mcpServers", validate_mcp_server)?,
        );
    }
    if let Some(value) = data.get("lsp") {
        validated.insert("lsp".into(), validate_lsp(value.clone())?);
    }
    insert_optional_value(&mut validated, &data, "skills", "config", validate_skills)?;
    insert_optional_value(
        &mut validated,
        &data,
        "notifications",
        "config",
        validate_notifications,
    )?;
    Ok(Value::Object(validated))
}

pub fn validate_key_config(value: Value) -> ConfigValidationResult<Value> {
    Ok(Value::Object(string_record(value, "key config")?))
}

fn validate_model_config(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    assert_exact_keys(
        &data,
        &[
            "type",
            "nickname",
            "baseUrl",
            "apiEnvVar",
            "auth",
            "model",
            "context",
            "reasoning",
            "thinkingBudgetTokens",
            "modalities",
        ],
        context,
    )?;
    let mut validated = Map::new();
    insert_optional_enum(
        &mut validated,
        &data,
        "type",
        &["standard", "openai-responses", "anthropic", "gemini"],
        context,
    )?;
    insert_required_string(&mut validated, &data, "nickname", context)?;
    insert_required_string(&mut validated, &data, "baseUrl", context)?;
    insert_optional_string(&mut validated, &data, "apiEnvVar", context)?;
    insert_optional_value(&mut validated, &data, "auth", context, validate_auth)?;
    insert_required_string(&mut validated, &data, "model", context)?;
    insert_required_number(&mut validated, &data, "context", context)?;
    insert_optional_enum(
        &mut validated,
        &data,
        "reasoning",
        &["none", "minimal", "low", "medium", "high", "xhigh"],
        context,
    )?;
    validate_thinking_budget_tokens(&data, context)?;
    insert_optional_u64_number(&mut validated, &data, "thinkingBudgetTokens", context)?;
    insert_optional_value(
        &mut validated,
        &data,
        "modalities",
        context,
        validate_modalities,
    )?;
    Ok(Value::Object(validated))
}

fn validate_thinking_budget_tokens(
    data: &Map<String, Value>,
    context: &str,
) -> ConfigValidationResult<()> {
    let Some(value) = data.get("thinkingBudgetTokens") else {
        return Ok(());
    };
    let Some(budget_tokens) = value.as_u64() else {
        return Ok(());
    };
    let Some(context_tokens) = data.get("context").and_then(Value::as_u64) else {
        return Ok(());
    };
    let max_tokens = context_tokens.min(32_000);
    if budget_tokens >= max_tokens {
        return Err(ConfigValidationError::new(format!(
            "{context}.thinkingBudgetTokens must be less than {max_tokens}"
        )));
    }
    Ok(())
}

fn validate_autofix_model(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    assert_exact_keys(&data, &["baseUrl", "apiEnvVar", "auth", "model"], context)?;
    let mut validated = Map::new();
    insert_required_string(&mut validated, &data, "baseUrl", context)?;
    insert_optional_string(&mut validated, &data, "apiEnvVar", context)?;
    insert_optional_value(&mut validated, &data, "auth", context, validate_auth)?;
    insert_required_string(&mut validated, &data, "model", context)?;
    Ok(Value::Object(validated))
}

fn validate_auth(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    match data.get("type").and_then(Value::as_str) {
        Some("env") => {
            assert_exact_keys(&data, &["type", "name"], context)?;
            let mut validated = Map::new();
            validated.insert("type".into(), Value::String("env".into()));
            insert_required_string(&mut validated, &data, "name", context)?;
            Ok(Value::Object(validated))
        }
        Some("command") => {
            assert_exact_keys(&data, &["type", "command"], context)?;
            let mut validated = Map::new();
            validated.insert("type".into(), Value::String("command".into()));
            validated.insert(
                "command".into(),
                Value::Array(string_array(
                    field(&data, "command", context)?.clone(),
                    &format!("{context}.command"),
                )?),
            );
            Ok(Value::Object(validated))
        }
        _ => Err(ConfigValidationError::new(format!(
            "Expected {context}.type to be env or command"
        ))),
    }
}

fn validate_mcp_server(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    assert_exact_keys(&data, &["command", "args", "env"], context)?;
    let mut validated = Map::new();
    insert_required_string(&mut validated, &data, "command", context)?;
    insert_optional_string_array(&mut validated, &data, "args", context)?;
    if let Some(value) = data.get("env") {
        validated.insert(
            "env".into(),
            Value::Object(string_record(value.clone(), &format!("{context}.env"))?),
        );
    }
    Ok(Value::Object(validated))
}

fn validate_lsp(value: Value) -> ConfigValidationResult<Value> {
    if value == Value::Bool(false) {
        return Ok(Value::Bool(false));
    }
    map_record(value, "config.lsp", validate_lsp_entry)
}

fn validate_lsp_entry(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value.clone(), context)?;
    if data.contains_key("disabled") {
        assert_exact_keys(&data, &["disabled"], context)?;
        if data.get("disabled") == Some(&Value::Bool(true)) {
            return Ok(json_object([("disabled", Value::Bool(true))]));
        }
        return Err(ConfigValidationError::new(format!(
            "Expected {context}.disabled to be true"
        )));
    }
    validate_lsp_server(value, context)
}

fn validate_lsp_server(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    assert_exact_keys(&data, &["command", "extensions", "rootCandidates"], context)?;
    let mut validated = Map::new();
    insert_required_string_array(&mut validated, &data, "command", context)?;
    insert_required_string_array(&mut validated, &data, "extensions", context)?;
    insert_required_string_array(&mut validated, &data, "rootCandidates", context)?;
    Ok(Value::Object(validated))
}

fn validate_modalities(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    let Some(image) = data.get("image") else {
        return Ok(Value::Object(Map::new()));
    };
    let image_data = object(image.clone(), &format!("{context}.image"))?;
    let mut image_object = Map::new();
    insert_required_boolean(
        &mut image_object,
        &image_data,
        "enabled",
        &format!("{context}.image"),
    )?;
    insert_required_number(
        &mut image_object,
        &image_data,
        "maxSizeMB",
        &format!("{context}.image"),
    )?;
    insert_required_string_array(
        &mut image_object,
        &image_data,
        "acceptedMimeTypes",
        &format!("{context}.image"),
    )?;
    let mut modalities = Map::new();
    modalities.insert("image".into(), Value::Object(image_object));
    Ok(Value::Object(modalities))
}

fn validate_search(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    let mut validated = Map::new();
    insert_required_string(&mut validated, &data, "url", context)?;
    insert_optional_string(&mut validated, &data, "apiEnvVar", context)?;
    insert_optional_value(&mut validated, &data, "auth", context, validate_auth)?;
    Ok(Value::Object(validated))
}

fn validate_skills(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    assert_exact_keys(&data, &["paths"], context)?;
    let mut validated = Map::new();
    insert_optional_string_array(&mut validated, &data, "paths", context)?;
    Ok(Value::Object(validated))
}

fn validate_notifications(value: Value, context: &str) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    let mut validated = Map::new();
    insert_optional_string(&mut validated, &data, "notifyCommand", context)?;
    insert_optional_number(&mut validated, &data, "notifyTimeoutMs", context)?;
    insert_optional_boolean(&mut validated, &data, "alwaysNotify", context)?;
    Ok(Value::Object(validated))
}

fn object(value: Value, context: &str) -> ConfigValidationResult<Map<String, Value>> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| ConfigValidationError::new(format!("Expected {context} to be an object")))
}

fn field<'a>(
    data: &'a Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<&'a Value> {
    data.get(key).ok_or_else(|| {
        ConfigValidationError::new(format!("Expected {context}.{key} to be present"))
    })
}

fn assert_exact_keys(
    data: &Map<String, Value>,
    allowed: &[&str],
    context: &str,
) -> ConfigValidationResult<()> {
    for key in data.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(ConfigValidationError::new(format!(
                "Unknown key {context}.{key}"
            )));
        }
    }
    Ok(())
}

fn string_value(value: &Value, context: &str) -> ConfigValidationResult<String> {
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| ConfigValidationError::new(format!("Expected {context} to be a string")))
}

fn number_value(value: &Value, context: &str) -> ConfigValidationResult<Value> {
    if value.is_number() {
        return Ok(value.clone());
    }
    Err(ConfigValidationError::new(format!(
        "Expected {context} to be a number"
    )))
}

fn boolean_value(value: &Value, context: &str) -> ConfigValidationResult<bool> {
    value
        .as_bool()
        .ok_or_else(|| ConfigValidationError::new(format!("Expected {context} to be a boolean")))
}

fn string_array(value: Value, context: &str) -> ConfigValidationResult<Vec<Value>> {
    let Value::Array(values) = value else {
        return Err(ConfigValidationError::new(format!(
            "Expected {context} to be an array"
        )));
    };
    values
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            string_value(entry, &format!("{context}[{index}]")).map(Value::String)
        })
        .collect()
}

fn string_record(value: Value, context: &str) -> ConfigValidationResult<Map<String, Value>> {
    let data = object(value, context)?;
    data.iter()
        .map(|(key, value)| {
            Ok((
                key.clone(),
                Value::String(string_value(value, &format!("{context}.{key}"))?),
            ))
        })
        .collect()
}

fn map_record(
    value: Value,
    context: &str,
    validate: fn(Value, &str) -> ConfigValidationResult<Value>,
) -> ConfigValidationResult<Value> {
    let data = object(value, context)?;
    Ok(Value::Object(
        data.into_iter()
            .map(|(key, value)| {
                validate(value, &format!("{context}.{key}")).map(|value| (key, value))
            })
            .collect::<ConfigValidationResult<Map<String, Value>>>()?,
    ))
}

fn enum_string(value: &Value, allowed: &[&str], context: &str) -> ConfigValidationResult<String> {
    let value = string_value(value, context)?;
    if allowed.contains(&value.as_str()) {
        return Ok(value);
    }
    Err(ConfigValidationError::new(format!(
        "Expected {context} to be one of {}",
        allowed.join(", ")
    )))
}

fn string_field(
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<String> {
    string_value(field(data, key, context)?, &format!("{context}.{key}"))
}

fn boolean_field(
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<bool> {
    boolean_value(field(data, key, context)?, &format!("{context}.{key}"))
}

fn insert_required_string(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    target.insert(key.into(), Value::String(string_field(data, key, context)?));
    Ok(())
}

fn insert_optional_string(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    if let Some(value) = data.get(key) {
        target.insert(
            key.into(),
            Value::String(string_value(value, &format!("{context}.{key}"))?),
        );
    }
    Ok(())
}

fn insert_required_number(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    target.insert(
        key.into(),
        number_value(field(data, key, context)?, &format!("{context}.{key}"))?,
    );
    Ok(())
}

fn insert_optional_number(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    if let Some(value) = data.get(key) {
        target.insert(
            key.into(),
            number_value(value, &format!("{context}.{key}"))?,
        );
    }
    Ok(())
}

fn insert_optional_u64_number(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    if let Some(value) = data.get(key) {
        let Some(number) = value.as_u64() else {
            return Err(ConfigValidationError::new(format!(
                "{context}.{key} must be a non-negative integer"
            )));
        };
        if key == "thinkingBudgetTokens" && number < 1024 {
            return Err(ConfigValidationError::new(format!(
                "{context}.{key} must be at least 1024"
            )));
        }
        target.insert(key.into(), Value::from(number));
    }
    Ok(())
}

fn insert_required_boolean(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    target.insert(key.into(), Value::Bool(boolean_field(data, key, context)?));
    Ok(())
}

fn insert_optional_boolean(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    if let Some(value) = data.get(key) {
        target.insert(
            key.into(),
            Value::Bool(boolean_value(value, &format!("{context}.{key}"))?),
        );
    }
    Ok(())
}

fn insert_required_string_array(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    target.insert(
        key.into(),
        Value::Array(string_array(
            field(data, key, context)?.clone(),
            &format!("{context}.{key}"),
        )?),
    );
    Ok(())
}

fn insert_optional_string_array(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
) -> ConfigValidationResult<()> {
    if let Some(value) = data.get(key) {
        target.insert(
            key.into(),
            Value::Array(string_array(value.clone(), &format!("{context}.{key}"))?),
        );
    }
    Ok(())
}

fn insert_optional_enum(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    allowed: &[&str],
    context: &str,
) -> ConfigValidationResult<()> {
    if let Some(value) = data.get(key) {
        target.insert(
            key.into(),
            Value::String(enum_string(value, allowed, &format!("{context}.{key}"))?),
        );
    }
    Ok(())
}

fn insert_optional_value(
    target: &mut Map<String, Value>,
    data: &Map<String, Value>,
    key: &str,
    context: &str,
    validate: fn(Value, &str) -> ConfigValidationResult<Value>,
) -> ConfigValidationResult<()> {
    if let Some(value) = data.get(key) {
        target.insert(
            key.into(),
            validate(value.clone(), &format!("{context}.{key}"))?,
        );
    }
    Ok(())
}

fn json_object<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect(),
    )
}
