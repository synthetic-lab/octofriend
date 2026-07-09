use octofwen_models::compiler::{CompilerUsage, TokenType, TokenUsageTracker};

#[test]
fn compiler_usage_splits_cached_input_from_uncached_input() {
    let usage = CompilerUsage::new(10, 4, 3);

    assert_eq!(usage.input.cached, 3);
    assert_eq!(usage.input.uncached, 7);
    assert_eq!(usage.input.total, 10);
    assert_eq!(usage.output, 4);
    assert!(usage.has_tokens());
}

#[test]
fn compiler_usage_does_not_report_tokens_for_empty_usage() {
    assert!(!CompilerUsage::new(0, 0, 0).has_tokens());
}

#[test]
fn compiler_usage_saturates_uncached_input_at_zero() {
    let usage = CompilerUsage::new(3, 0, 10);

    assert_eq!(usage.input.cached, 10);
    assert_eq!(usage.input.uncached, 0);
    assert_eq!(usage.input.total, 3);
}

#[test]
fn token_usage_tracker_starts_unseen_models_with_zero_counts_for_the_opposite_token_type() {
    let mut tracker = TokenUsageTracker::new();

    tracker.track_tokens("test-start-model", TokenType::Input, 3);

    assert_eq!(tracker.token_counts()["test-start-model"].input, 3);
    assert_eq!(tracker.token_counts()["test-start-model"].output, 0);
}

#[test]
fn token_usage_tracker_accumulates_input_and_output_token_counts_by_model() {
    let mut tracker = TokenUsageTracker::new();

    tracker.track_tokens("test-accumulate-model", TokenType::Input, 2);
    tracker.track_tokens("test-accumulate-model", TokenType::Input, 5);
    tracker.track_tokens("test-accumulate-model", TokenType::Output, 7);

    assert_eq!(tracker.token_counts()["test-accumulate-model"].input, 7);
    assert_eq!(tracker.token_counts()["test-accumulate-model"].output, 7);
}
