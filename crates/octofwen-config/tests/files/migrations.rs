use octofwen_config::files::{CURRENT_CONFIG_VERSION, migrate_config};
use serde_json::json;

#[test]
fn migrates_legacy_notify_finish_command_to_notifications() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "notifyFinishCommand": "say done",
        "models": []
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(migrated["notifications"]["notifyCommand"], "say done");
    assert!(migrated.get("notifyFinishCommand").is_none());
}

#[test]
fn merges_legacy_notify_finish_command_into_existing_notifications() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "notifyFinishCommand": "say legacy done",
        "notifications": {
            "notifyTimeoutMs": 20_000,
            "alwaysNotify": true
        },
        "models": []
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(
        migrated["notifications"],
        json!({
            "notifyCommand": "say legacy done",
            "notifyTimeoutMs": 20_000,
            "alwaysNotify": true
        })
    );
    assert!(migrated.get("notifyFinishCommand").is_none());
}

#[test]
fn preserves_existing_notify_command_over_legacy_notify_finish_command() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "notifyFinishCommand": "say legacy done",
        "notifications": {
            "notifyCommand": "say current done",
            "notifyTimeoutMs": 20_000
        },
        "models": []
    }));

    assert_eq!(
        migrated["notifications"]["notifyCommand"],
        "say current done"
    );
    assert_eq!(migrated["notifications"]["notifyTimeoutMs"], 20_000);
    assert!(migrated.get("notifyFinishCommand").is_none());
}

#[test]
fn migrates_known_model_modalities_from_the_provider_catalog() {
    let migrated = migrate_config(json!({
        "configVersion": 0,
        "yourName": "Ada",
        "models": [{
            "nickname": "Kimi K2.5",
            "baseUrl": "https://api.synthetic.new/v1",
            "model": "hf:moonshotai/Kimi-K2.5",
            "context": 262_144
        }]
    }));

    assert_eq!(
        migrated["models"][0]["modalities"]["image"]["acceptedMimeTypes"],
        json!(["image/jpeg", "image/png", "image/webp", "image/gif"])
    );
}

#[test]
fn migrates_legacy_synthetic_base_url_model_modalities() {
    for base_url in [
        "https://api.synthetic.new/openai/v1",
        "https://synthetic.new/api/openai/v1",
        "https://api.glhf.chat/v1",
        "https://glhf.chat/api/v1",
        "https://glhf.chat/api/openai/v1",
    ] {
        let migrated = migrate_config(json!({
            "configVersion": 0,
            "yourName": "Ada",
            "models": [{
                "nickname": "Kimi K2.5",
                "baseUrl": base_url,
                "model": "hf:moonshotai/Kimi-K2.5",
                "context": 262_144
            }]
        }));

        assert_eq!(
            migrated["models"][0]["modalities"]["image"]["acceptedMimeTypes"],
            json!(["image/jpeg", "image/png", "image/webp", "image/gif"]),
            "{base_url}"
        );
    }
}

#[test]
fn migrates_missing_known_model_context_from_the_provider_catalog() {
    let migrated = migrate_config(json!({
        "configVersion": 3,
        "yourName": "Ada",
        "models": [{
            "nickname": "Kimi K2.5",
            "baseUrl": "https://api.synthetic.new/v1",
            "model": "hf:moonshotai/Kimi-K2.5"
        }]
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(migrated["models"][0]["context"], 256 * 1024);
}

#[test]
fn migrates_missing_custom_model_context_to_the_legacy_default() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [{
            "nickname": "Local GPT",
            "baseUrl": "http://localhost:11434/v1",
            "apiEnvVar": "LOCAL_API_KEY",
            "model": "openai/gpt-oss-20b"
        }]
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(migrated["models"][0]["context"], 128_000);
}

#[test]
fn preserves_existing_numeric_model_context_during_missing_context_migration() {
    let migrated = migrate_config(json!({
        "configVersion": 3,
        "yourName": "Ada",
        "models": [{
            "nickname": "Custom",
            "baseUrl": "https://custom.invalid/v1",
            "model": "custom-model",
            "context": 64.5
        }]
    }));

    assert_eq!(migrated["models"][0]["context"], 64.5);
}

#[test]
fn migrates_missing_provider_types_from_known_base_urls() {
    let migrated = migrate_config(json!({
        "configVersion": 0,
        "yourName": "Ada",
        "models": [
            {
                "nickname": "OpenAI",
                "baseUrl": "https://api.openai.com/v1",
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "Anthropic",
                "baseUrl": "https://api.anthropic.com",
                "model": "claude-sonnet-4-5",
                "context": 200_000
            },
            {
                "nickname": "Gemini",
                "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
                "model": "gemini-3.5-flash",
                "context": 1_000_000
            },
            {
                "nickname": "Synthetic",
                "baseUrl": "https://api.synthetic.new/v1",
                "model": "hf:moonshotai/Kimi-K2.5",
                "context": 262_144
            }
        ]
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(migrated["models"][0]["type"], "openai-responses");
    assert_eq!(migrated["models"][1]["type"], "anthropic");
    assert_eq!(migrated["models"][2]["type"], "gemini");
    assert!(migrated["models"][3].get("type").is_none());
}

#[test]
fn migrates_provider_metadata_from_normalized_base_urls() {
    let migrated = migrate_config(json!({
        "configVersion": 0,
        "yourName": "Ada",
        "models": [
            {
                "nickname": "OpenAI",
                "baseUrl": " https://api.openai.com/v1/ ",
                "model": "gpt-5.4-mini"
            },
            {
                "nickname": "Synthetic",
                "baseUrl": " https://api.synthetic.new/openai/v1/ ",
                "model": "hf:moonshotai/Kimi-K2.5"
            }
        ]
    }));

    assert_eq!(migrated["models"][0]["type"], "openai-responses");
    assert_eq!(migrated["models"][0]["context"], 400_000);
    assert_eq!(migrated["models"][1]["context"], 256 * 1024);
    assert_eq!(
        migrated["models"][1]["modalities"]["image"]["acceptedMimeTypes"],
        json!(["image/jpeg", "image/png", "image/webp", "image/gif"])
    );
}

#[test]
fn migrates_known_model_metadata_for_local_proxy_model_names() {
    let migrated = migrate_config(json!({
        "configVersion": 0,
        "yourName": "Ada",
        "models": [
            {
                "nickname": "Local Synthetic",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "model": "hf:moonshotai/Kimi-K2.5"
            },
            {
                "nickname": "Local OpenAI",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "model": "gpt-5.4-mini"
            }
        ]
    }));

    assert_eq!(migrated["models"][0]["context"], 256 * 1024);
    assert_eq!(
        migrated["models"][0]["modalities"]["image"]["acceptedMimeTypes"],
        json!(["image/jpeg", "image/png", "image/webp", "image/gif"])
    );
    assert_eq!(migrated["models"][1]["type"], "openai-responses");
    assert_eq!(migrated["models"][1]["context"], 400_000);
}

#[test]
fn preserves_existing_model_type_during_provider_type_migration() {
    let migrated = migrate_config(json!({
        "configVersion": 4,
        "yourName": "Ada",
        "models": [{
            "type": "standard",
            "nickname": "OpenAI-compatible",
            "baseUrl": "https://api.openai.com/v1",
            "model": "custom",
            "context": 128_000
        }]
    }));

    assert_eq!(migrated["models"][0]["type"], "standard");
}

#[test]
fn preserves_current_config_data_while_setting_current_version() {
    let migrated = migrate_config(json!({
        "configVersion": CURRENT_CONFIG_VERSION,
        "yourName": "Ada",
        "models": [],
        "notifications": { "notifyCommand": "say done" }
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(migrated["notifications"]["notifyCommand"], "say done");
}
