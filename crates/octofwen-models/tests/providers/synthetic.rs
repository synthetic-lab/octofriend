use octofwen_models::providers::synthetic::{
    QuotaData, QuotaEntry, WeeklyEntry, format_time_until, parse_quota_json,
};

#[test]
fn parses_rolling_five_hour_and_weekly_quota_entries() {
    let parsed = parse_quota_json(
        r#"{
            "rollingFiveHourLimit": {
                "remaining": 2.5,
                "max": 10,
                "nextTickAt": "2026-03-02T13:00:00Z",
                "tickPercent": 0.25
            },
            "weeklyTokenLimit": {
                "nextRegenAt": "2026-03-03T12:00:00Z",
                "percentRemaining": 50,
                "maxCredits": "1000",
                "remainingCredits": "500",
                "nextRegenCredits": "100"
            }
        }"#,
    );

    assert_eq!(
        parsed,
        Some(QuotaData {
            rolling_five_hour_limit: Some(QuotaEntry {
                remaining: 2.5,
                max: 10.0,
                next_tick_at: "2026-03-02T13:00:00Z".into(),
                tick_percent: 0.25,
            }),
            weekly_token_limit: Some(WeeklyEntry {
                next_regen_at: "2026-03-03T12:00:00Z".into(),
                percent_remaining: 50.0,
                max_credits: "1000".into(),
                remaining_credits: "500".into(),
                next_regen_credits: "100".into(),
            }),
        })
    );
}

#[test]
fn returns_only_valid_quota_branches() {
    let parsed = parse_quota_json(
        r#"{
            "rollingFiveHourLimit": {
                "remaining": 1,
                "max": 2,
                "nextTickAt": "2026-03-02T12:30:00Z",
                "tickPercent": 0.5
            },
            "weeklyTokenLimit": {
                "nextRegenAt": "not-a-date",
                "percentRemaining": 50,
                "maxCredits": "1000",
                "remainingCredits": "500",
                "nextRegenCredits": "100"
            }
        }"#,
    );

    assert_eq!(
        parsed,
        Some(QuotaData {
            rolling_five_hour_limit: Some(QuotaEntry {
                remaining: 1.0,
                max: 2.0,
                next_tick_at: "2026-03-02T12:30:00Z".into(),
                tick_percent: 0.5,
            }),
            weekly_token_limit: None,
        })
    );
}

#[test]
fn returns_none_for_malformed_missing_or_invalid_quota_data() {
    assert_eq!(parse_quota_json("not json"), None);
    assert_eq!(parse_quota_json("null"), None);
    assert_eq!(parse_quota_json("[]"), None);
    assert_eq!(parse_quota_json("{}"), None);
    assert_eq!(
        parse_quota_json(
            r#"{
                "rollingFiveHourLimit": {
                    "remaining": "1",
                    "max": 2,
                    "nextTickAt": "2026-03-02T12:30:00Z",
                    "tickPercent": 0.5
                }
            }"#,
        ),
        None
    );
    assert_eq!(
        parse_quota_json(
            r#"{
                "rollingFiveHourLimit": {
                    "remaining": 1,
                    "max": 2,
                    "nextTickAt": "invalid",
                    "tickPercent": 0.5
                }
            }"#,
        ),
        None
    );
}

#[test]
fn formats_time_until_with_pluralization_and_boundaries() {
    let now = "2026-03-02T12:00:00Z";

    assert_eq!(
        format_time_until("2026-03-02T12:01:00Z", now),
        Some("in 1 minute".into())
    );
    assert_eq!(
        format_time_until("2026-03-02T13:45:00Z", now),
        Some("in 1 hour 45 minutes".into())
    );
    assert_eq!(
        format_time_until("2026-03-03T18:00:00Z", now),
        Some("in 1 day 6 hours".into())
    );
    assert_eq!(
        format_time_until("2026-03-02T12:00:30Z", now),
        Some("in 1 minute".into())
    );
    assert_eq!(
        format_time_until("2026-03-02T11:59:30Z", now),
        Some("in 0 minutes".into())
    );
}
