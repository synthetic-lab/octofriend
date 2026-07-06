use octofwen_config::models::{
    DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE, PROVIDERS, ProviderKey, ProviderKind, ReasoningLevel,
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
            ProviderKey::Gemini,
            ProviderKey::Grok,
        ]
    );
    assert_eq!(SYNTHETIC_PROVIDER, &PROVIDERS[0]);
    assert_eq!(
        recommended_model(ProviderKey::Synthetic),
        &PROVIDERS[0].models[0]
    );
    assert_eq!(recommended_model(ProviderKey::OpenAi).nickname, "GPT-5.5");
    assert_eq!(PROVIDERS[2].kind, ProviderKind::Anthropic);
    assert_eq!(PROVIDERS[3].kind, ProviderKind::Gemini);
    assert_eq!(PROVIDERS[3].env_var, "GEMINI_API_KEY");
    assert_eq!(PROVIDERS[4].env_var, "XAI_API_KEY");
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
    assert_eq!(
        provider_for_base_url("https://generativelanguage.googleapis.com/v1beta"),
        Some(provider_for_key(ProviderKey::Gemini))
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

    let gemini_image = PROVIDERS[3].models[0]
        .modalities
        .and_then(|modalities| modalities.image)
        .expect("gemini model should support images");
    assert_eq!(gemini_image.max_size_mb, 20);
    assert!(gemini_image.accepted_mime_types.contains(&"image/webp"));

    let grok_image = PROVIDERS[4].models[0]
        .modalities
        .and_then(|modalities| modalities.image)
        .expect("grok model should support images");
    assert_eq!(grok_image.accepted_mime_types, ["image/jpeg", "image/png"]);
}

#[test]
fn exports_native_gemini_provider_metadata() {
    let gemini = provider_for_key(ProviderKey::Gemini);

    assert_eq!(gemini.kind, ProviderKind::Gemini);
    assert_eq!(gemini.name, "Google Gemini");
    assert_eq!(gemini.env_var, "GEMINI_API_KEY");
    assert_eq!(
        gemini.base_url,
        "https://generativelanguage.googleapis.com/v1beta"
    );
    assert_eq!(gemini.api_key_url, "https://aistudio.google.com/apikey");
    assert_eq!(gemini.models[0].model, "gemini-3.5-flash");
    assert_eq!(gemini.models[0].context, 1_048_576);
    assert_eq!(gemini.test_model, "gemini-3.5-flash");
    assert_eq!(
        recommended_model(ProviderKey::Gemini).model,
        "gemini-3.5-flash"
    );
}

#[test]
fn exports_anthropic_reasoning_defaults() {
    let anthropic = provider_for_key(ProviderKey::Anthropic);
    let opus = anthropic
        .models
        .iter()
        .find(|model| model.model == "claude-opus-4-8")
        .expect("catalog should include Claude Opus 4.8");
    let sonnet = anthropic
        .models
        .iter()
        .find(|model| model.model == "claude-sonnet-5")
        .expect("catalog should include Claude Sonnet 5");

    assert_eq!(opus.reasoning, Some(ReasoningLevel::XHigh));
    assert_eq!(sonnet.reasoning, Some(ReasoningLevel::High));
}
