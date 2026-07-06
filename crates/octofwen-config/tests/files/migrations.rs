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
fn migrates_known_model_modalities_from_the_provider_catalog() {
    let migrated = migrate_config(json!({
        "configVersion": 0,
        "yourName": "Ada",
        "models": [{
            "nickname": "Kimi K2.5",
            "baseUrl": "https://api.synthetic.new/v1",
            "model": "hf:moonshotai/Kimi-K2.5",
            "context": 262144
        }]
    }));

    assert_eq!(
        migrated["models"][0]["modalities"]["image"]["acceptedMimeTypes"],
        json!(["image/jpeg", "image/png", "image/webp", "image/gif"])
    );
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
