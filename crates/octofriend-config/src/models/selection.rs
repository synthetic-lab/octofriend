#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModelConfig {
    pub nickname: String,
    pub base_url: String,
    pub model: String,
    pub context: u32,
}

pub fn model_from_config<'a>(
    models: &'a [ModelConfig],
    model_override: Option<&str>,
) -> Option<&'a ModelConfig> {
    let first = models.first()?;
    let Some(model_override) = model_override else {
        return Some(first);
    };
    models
        .iter()
        .find(|model| model.nickname == model_override)
        .or(Some(first))
}

pub fn selected_model_from_config(
    config: &serde_json::Value,
    model_override: Option<&str>,
) -> Option<serde_json::Value> {
    let models = config.get("models")?.as_array()?;
    let first = models.first()?.clone();
    let Some(model_override) = model_override else {
        return Some(first);
    };
    models
        .iter()
        .find(|model| {
            model.get("nickname").and_then(serde_json::Value::as_str) == Some(model_override)
        })
        .cloned()
        .or(Some(first))
}
