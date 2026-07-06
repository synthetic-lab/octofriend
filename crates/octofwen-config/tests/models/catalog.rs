use octofwen_config::models::{
    DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE, PROVIDERS, ProviderKey, ProviderKind,
    SYNTHETIC_PROVIDER, key_from_name, provider_for_base_url, provider_for_key, recommended_model,
};

#[test]
fn exports_builtin_provider_metadata_with_stable_keys_and_recommended_models() {
    assert_eq!(
        PROVIDERS
            .iter()
            .map(|provider| provider.key)
            .collect::<Vec<_>>(),
        [
            ProviderKey::Synthetic,
            ProviderKey::OpenAi,
            ProviderKey::Anthropic,
            ProviderKey::Grok,
        ]
    );
    assert_eq!(SYNTHETIC_PROVIDER, &PROVIDERS[0]);
    assert_eq!(
        recommended_model(ProviderKey::Synthetic),
        &PROVIDERS[0].models[0]
    );
    assert_eq!(
        recommended_model(ProviderKey::OpenAi).nickname,
        "GPT-5.3 Codex"
    );
    assert_eq!(PROVIDERS[2].kind, ProviderKind::Anthropic);
    assert_eq!(PROVIDERS[3].env_var, "XAI_API_KEY");
}

#[test]
fn maps_provider_display_names_and_base_urls_to_catalog_entries() {
    assert_eq!(key_from_name("Synthetic"), Ok(ProviderKey::Synthetic));
    assert_eq!(key_from_name("OpenAI"), Ok(ProviderKey::OpenAi));
    assert_eq!(
        provider_for_base_url("https://api.synthetic.new/v1"),
        Some(provider_for_key(ProviderKey::Synthetic))
    );
    assert_eq!(
        provider_for_base_url("https://api.anthropic.com"),
        Some(provider_for_key(ProviderKey::Anthropic))
    );
    assert_eq!(provider_for_base_url("https://example.invalid"), None);
    assert_eq!(
        key_from_name("Missing Provider").map_err(|error| error.to_string()),
        Err("No provider named Missing Provider found".into())
    );
}

#[test]
fn preserves_multimodal_model_metadata() {
    assert_eq!(DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE, "Kimi K2.5");
    let synthetic_image = PROVIDERS[0].models[0]
        .modalities
        .and_then(|modalities| modalities.image)
        .expect("synthetic recommended model should support images");
    assert!(synthetic_image.enabled);
    assert_eq!(synthetic_image.max_size_mb, 10);
    assert!(synthetic_image.accepted_mime_types.contains(&"image/webp"));

    let grok_image = PROVIDERS[3].models[0]
        .modalities
        .and_then(|modalities| modalities.image)
        .expect("grok model should support images");
    assert_eq!(grok_image.accepted_mime_types, ["image/jpeg", "image/png"]);
}
