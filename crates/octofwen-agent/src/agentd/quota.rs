use octofwen_llm::providers::synthetic::QuotaData;
use serde_json::{Value, json};

pub(super) fn quota_json(quota: QuotaData) -> Value {
    let mut value = serde_json::Map::new();
    if let Some(entry) = quota.rolling_five_hour_limit {
        value.insert(
            "rollingFiveHourLimit".into(),
            json!({
                "remaining": entry.remaining,
                "max": entry.max,
                "nextTickAt": entry.next_tick_at,
                "tickPercent": entry.tick_percent,
            }),
        );
    }
    if let Some(entry) = quota.weekly_token_limit {
        value.insert(
            "weeklyTokenLimit".into(),
            json!({
                "nextRegenAt": entry.next_regen_at,
                "percentRemaining": entry.percent_remaining,
                "maxCredits": entry.max_credits,
                "remainingCredits": entry.remaining_credits,
                "nextRegenCredits": entry.next_regen_credits,
            }),
        );
    }
    Value::Object(value)
}
