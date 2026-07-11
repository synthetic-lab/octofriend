use octofriend_agent::run_events::{
    TrajectoryEvent, TrajectoryFinishReason, compiler_error_to_finish_reason,
    parse_quota_from_headers, quota_update_event_from_headers,
};
use octofriend_models::compiler::CompilerError;
use octofriend_models::providers::synthetic::{QuotaData, QuotaEntry};

#[test]
fn compiler_payment_and_rate_limit_errors_remain_recoverable_finish_reasons() {
    assert_eq!(
        compiler_error_to_finish_reason(CompilerError::Payment {
            request_error: "buy credits".into(),
            curl: "curl payment".into(),
        }),
        TrajectoryFinishReason::PaymentError {
            request_error: "buy credits".into(),
            curl: "curl payment".into(),
        }
    );

    assert_eq!(
        compiler_error_to_finish_reason(CompilerError::RateLimit {
            request_error: "slow down".into(),
            curl: "curl rate".into(),
        }),
        TrajectoryFinishReason::RateLimitError {
            request_error: "slow down".into(),
            curl: "curl rate".into(),
        }
    );
}

#[test]
fn compiler_request_like_errors_become_request_finish_reasons() {
    assert_eq!(
        compiler_error_to_finish_reason(CompilerError::Request {
            request_error: "network down".into(),
            curl: "curl request".into(),
        }),
        TrajectoryFinishReason::RequestError {
            request_error: "network down".into(),
            curl: "curl request".into(),
        }
    );
}

#[test]
fn parses_synthetic_quota_header_case_insensitively() {
    let quota = parse_quota_from_headers(&[(
        "X-Synthetic-Quotas".into(),
        r#"{"rollingFiveHourLimit":{"remaining":1,"max":2,"nextTickAt":"2026-01-02T03:04:05Z","tickPercent":50},"weeklyTokenLimit":null}"#.into(),
    )]);

    assert_eq!(
        quota,
        Some(QuotaData {
            rolling_five_hour_limit: Some(QuotaEntry {
                remaining: 1.0,
                max: 2.0,
                next_tick_at: "2026-01-02T03:04:05Z".into(),
                tick_percent: 50.0,
            }),
            weekly_token_limit: None,
        })
    );
}

#[test]
fn quota_update_event_is_created_from_parseable_synthetic_quota_header() {
    let event = quota_update_event_from_headers(&[(
        "x-synthetic-quotas".into(),
        r#"{"rollingFiveHourLimit":{"remaining":3,"max":4,"nextTickAt":"2026-01-02T03:04:05Z","tickPercent":75},"weeklyTokenLimit":null}"#.into(),
    )]);

    assert_eq!(
        event,
        Some(TrajectoryEvent::QuotaUpdated {
            quota: QuotaData {
                rolling_five_hour_limit: Some(QuotaEntry {
                    remaining: 3.0,
                    max: 4.0,
                    next_tick_at: "2026-01-02T03:04:05Z".into(),
                    tick_percent: 75.0,
                }),
                weekly_token_limit: None,
            },
        })
    );
}

#[test]
fn quota_update_event_is_absent_without_parseable_quota_header() {
    assert_eq!(quota_update_event_from_headers(&[]), None);
    assert_eq!(
        quota_update_event_from_headers(&[("x-synthetic-quotas".into(), "not json".into())]),
        None
    );
}
