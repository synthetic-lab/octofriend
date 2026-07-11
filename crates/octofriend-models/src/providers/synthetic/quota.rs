use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub struct QuotaEntry {
    pub remaining: f64,
    pub max: f64,
    pub next_tick_at: String,
    pub tick_percent: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WeeklyEntry {
    pub next_regen_at: String,
    pub percent_remaining: f64,
    pub max_credits: String,
    pub remaining_credits: String,
    pub next_regen_credits: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct QuotaData {
    pub rolling_five_hour_limit: Option<QuotaEntry>,
    pub weekly_token_limit: Option<WeeklyEntry>,
}

pub fn parse_quota_json(data: &str) -> Option<QuotaData> {
    let raw = serde_json::from_str::<Value>(data).ok()?;
    let object = raw.as_object()?;

    let rolling_five_hour_limit = object
        .get("rollingFiveHourLimit")
        .and_then(parse_optional_quota_entry);
    let weekly_token_limit = object
        .get("weeklyTokenLimit")
        .and_then(parse_optional_weekly_entry);

    if rolling_five_hour_limit.is_none() && weekly_token_limit.is_none() {
        return None;
    }

    Some(QuotaData {
        rolling_five_hour_limit,
        weekly_token_limit,
    })
}

pub fn format_time_until(expires_at: &str, now: &str) -> Option<String> {
    let expires_at = parse_timestamp_seconds(expires_at)?;
    let now = parse_timestamp_seconds(now)?;
    let diff_seconds = expires_at - now;
    if diff_seconds <= 0 {
        return Some("in 0 minutes".into());
    }

    let diff_mins = (diff_seconds + 59) / 60;
    if diff_mins < 60 {
        return Some(format!("in {}", format_unit(diff_mins, "minute")));
    }

    let diff_hours = diff_mins / 60;
    let remaining_mins = diff_mins % 60;
    if diff_hours < 24 {
        return Some(if remaining_mins > 0 {
            format!(
                "in {} {}",
                format_unit(diff_hours, "hour"),
                format_unit(remaining_mins, "minute")
            )
        } else {
            format!("in {}", format_unit(diff_hours, "hour"))
        });
    }

    let diff_days = diff_hours / 24;
    let remaining_hours = diff_hours % 24;
    Some(if remaining_hours > 0 {
        format!(
            "in {} {}",
            format_unit(diff_days, "day"),
            format_unit(remaining_hours, "hour")
        )
    } else {
        format!("in {}", format_unit(diff_days, "day"))
    })
}

fn parse_optional_quota_entry(raw: &Value) -> Option<QuotaEntry> {
    if raw.is_null() {
        return None;
    }
    let object = raw.as_object()?;
    let next_tick_at = object.get("nextTickAt")?.as_str()?;
    parse_timestamp_seconds(next_tick_at)?;

    Some(QuotaEntry {
        remaining: object.get("remaining")?.as_f64()?,
        max: object.get("max")?.as_f64()?,
        next_tick_at: next_tick_at.into(),
        tick_percent: object.get("tickPercent")?.as_f64()?,
    })
}

fn parse_optional_weekly_entry(raw: &Value) -> Option<WeeklyEntry> {
    if raw.is_null() {
        return None;
    }
    let object = raw.as_object()?;
    let next_regen_at = object.get("nextRegenAt")?.as_str()?;
    parse_timestamp_seconds(next_regen_at)?;

    Some(WeeklyEntry {
        next_regen_at: next_regen_at.into(),
        percent_remaining: object.get("percentRemaining")?.as_f64()?,
        max_credits: object.get("maxCredits")?.as_str()?.into(),
        remaining_credits: object.get("remainingCredits")?.as_str()?.into(),
        next_regen_credits: object.get("nextRegenCredits")?.as_str()?.into(),
    })
}

fn parse_timestamp_seconds(value: &str) -> Option<i64> {
    if value.len() != 20 || !value.ends_with('Z') {
        return None;
    }

    let year = parse_fixed_i64(value, 0, 4)?;
    expect_byte(value, 4, b'-')?;
    let month = parse_fixed_i64(value, 5, 7)?;
    expect_byte(value, 7, b'-')?;
    let day = parse_fixed_i64(value, 8, 10)?;
    expect_byte(value, 10, b'T')?;
    let hour = parse_fixed_i64(value, 11, 13)?;
    expect_byte(value, 13, b':')?;
    let minute = parse_fixed_i64(value, 14, 16)?;
    expect_byte(value, 16, b':')?;
    let second = parse_fixed_i64(value, 17, 19)?;

    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }

    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

fn parse_fixed_i64(value: &str, start: usize, end: usize) -> Option<i64> {
    value.get(start..end)?.parse().ok()
}

fn expect_byte(value: &str, index: usize, expected: u8) -> Option<()> {
    (value.as_bytes().get(index).copied()? == expected).then_some(())
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn format_unit(value: i64, unit: &str) -> String {
    if value == 1 {
        format!("{value} {unit}")
    } else {
        format!("{value} {unit}s")
    }
}
