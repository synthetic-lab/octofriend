use octofriend_config::models::{ModelConfig, model_from_config};

fn models() -> Vec<ModelConfig> {
    vec![
        ModelConfig {
            nickname: "first".into(),
            base_url: "https://first.invalid/v1".into(),
            model: "first-model".into(),
            context: 128_000,
        },
        ModelConfig {
            nickname: "second".into(),
            base_url: "https://second.invalid/v1".into(),
            model: "second-model".into(),
            context: 64_000,
        },
    ]
}

#[test]
fn returns_first_model_without_override() {
    let models = models();

    assert_eq!(model_from_config(&models, None), models.first());
}

#[test]
fn returns_matching_model_for_override() {
    let models = models();

    assert_eq!(model_from_config(&models, Some("second")), models.get(1));
}

#[test]
fn falls_back_to_first_model_for_missing_override() {
    let models = models();

    assert_eq!(model_from_config(&models, Some("missing")), models.first());
}

#[test]
fn returns_none_for_empty_model_list() {
    assert_eq!(model_from_config(&[], Some("missing")), None);
}
