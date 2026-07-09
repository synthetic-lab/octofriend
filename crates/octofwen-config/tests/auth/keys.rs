use std::collections::BTreeMap;

use octofwen_config::auth::{
    api_key_map_from_value, default_env_var, is_synthetic_base_url, parse_api_key_map,
    provider_env_var_for_base_url,
};
use octofwen_config::models::{ProviderKey, provider_for_key};

#[test]
fn resolves_default_provider_env_vars_and_overrides_by_config_key() {
    let openai = provider_for_key(ProviderKey::OpenAi);
    let mut overrides = BTreeMap::new();
    overrides.insert("openai".into(), "CUSTOM_OPENAI_KEY".into());

    assert_eq!(default_env_var(openai, None), "OPENAI_API_KEY");
    assert_eq!(
        default_env_var(openai, Some(&overrides)),
        "CUSTOM_OPENAI_KEY"
    );
    assert_eq!(
        provider_env_var_for_base_url("https://api.openai.com/v1", Some(&overrides)),
        Some("CUSTOM_OPENAI_KEY".into())
    );

    overrides.insert("openai".into(), " TRIMMED_OPENAI_KEY ".into());
    assert_eq!(
        default_env_var(openai, Some(&overrides)),
        "TRIMMED_OPENAI_KEY"
    );
    overrides.insert("openai".into(), "   ".into());
    assert_eq!(default_env_var(openai, Some(&overrides)), "OPENAI_API_KEY");
    overrides.insert("openai".into(), "CUSTOM_OPENAI_KEY".into());
    assert_eq!(
        provider_env_var_for_base_url(" https://api.openai.com/v1/ ", Some(&overrides)),
        Some("CUSTOM_OPENAI_KEY".into())
    );
    assert_eq!(
        provider_env_var_for_base_url("https://api.synthetic.new/openai/v1", None),
        Some("SYNTHETIC_API_KEY".into())
    );
    assert_eq!(
        provider_env_var_for_base_url("https://example.com", None),
        None
    );
}

#[test]
fn parses_legacy_key_files_with_trimmed_non_empty_entries() {
    let parsed = parse_api_key_map(
        r#"{
            " https://api.openai.com/v1/ ": " sk-test \n",
            "https://api.anthropic.com": "   ",
            "": "ignored"
        }"#,
    );

    assert_eq!(
        parsed.get("https://api.openai.com/v1/"),
        Some(&"sk-test".to_string())
    );
    assert!(!parsed.contains_key("https://api.anthropic.com"));
    assert!(!parsed.contains_key(""));

    let from_value = api_key_map_from_value(serde_json::json!({
        "https://api.synthetic.new/v1": " synthetic-key ",
        "https://empty.invalid/v1": "\t"
    }));
    assert_eq!(
        from_value.get("https://api.synthetic.new/v1"),
        Some(&"synthetic-key".to_string())
    );
    assert!(!from_value.contains_key("https://empty.invalid/v1"));
}

#[test]
fn recognizes_every_legacy_synthetic_base_url_for_key_lookup() {
    for base_url in [
        "https://api.synthetic.new/openai/v1",
        " https://api.synthetic.new/openai/v1/ ",
        "https://synthetic.new/api/openai/v1",
        "https://api.synthetic.new/v1",
        "https://api.glhf.chat/v1",
        "https://glhf.chat/api/v1",
        "https://glhf.chat/api/openai/v1",
    ] {
        assert!(is_synthetic_base_url(base_url), "{base_url}");
    }
    assert!(!is_synthetic_base_url("https://api.openai.com/v1"));
}
