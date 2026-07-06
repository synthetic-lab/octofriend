use std::collections::BTreeMap;

use octofwen_config::auth::{
    default_env_var, is_synthetic_base_url, provider_env_var_for_base_url,
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
    assert_eq!(
        provider_env_var_for_base_url("https://example.com", None),
        None
    );
}

#[test]
fn recognizes_every_legacy_synthetic_base_url_for_key_lookup() {
    for base_url in [
        "https://api.synthetic.new/openai/v1",
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
