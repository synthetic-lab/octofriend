use serde_json::Value;

pub(super) fn parse_server_sent_json_events(
    response_text: &str,
    error_label: &str,
) -> Result<Vec<Value>, String> {
    let mut events = Vec::new();
    let normalized_response_text = response_text.replace("\r\n", "\n");
    for frame in normalized_response_text.split("\n\n") {
        let data = frame
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let value = serde_json::from_str::<Value>(&data)
            .map_err(|error| format!("Invalid {error_label} stream JSON event: {error}"))?;
        events.push(value);
    }
    Ok(events)
}
