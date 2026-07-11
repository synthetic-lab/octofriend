use octofriend_models::providers::anthropic_messages_from_ts_ir;
use serde_json::json;

#[test]
fn lowers_typescript_ir_into_anthropic_messages() {
    let messages = anthropic_messages_from_ts_ir(
        &[
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "content": "hello" },
                    { "type": "image", "image": { "mimeType": "image/png", "base64Data": "abc" } }
                ]
            }),
            json!({
                "role": "assistant",
                "content": "answer",
                "anthropic": {
                    "thinkingBlocks": [
                        { "type": "thinking", "thinking": "think", "signature": "sig" }
                    ]
                },
                "toolCalls": [{
                    "type": "tool-call",
                    "toolCallId": "tool-1",
                    "name": "read",
                    "original": { "filePath": "README.md" }
                }]
            }),
            json!({
                "role": "tool-output",
                "toolCall": { "toolCallId": "tool-1" },
                "content": [{ "type": "text", "content": "contents" }]
            }),
            json!({
                "role": "tool-skip-output",
                "toolCall": { "toolCallId": "tool-2" },
                "reason": "read-only mode"
            }),
            json!({
                "role": "tool-parse-error",
                "malformedRequest": { "toolCallId": "tool-3", "error": "bad json" }
            }),
        ],
        Some(&["vision".into()]),
    )
    .expect("typescript ir should lower to anthropic messages");

    assert_eq!(
        messages,
        json!([
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "hello" },
                    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "abc" } }
                ]
            },
            {
                "role": "assistant",
                "content": [
                    { "type": "thinking", "thinking": "think", "signature": "sig" },
                    { "type": "text", "text": "answer" },
                    { "type": "tool_use", "id": "tool-1", "name": "read", "input": { "filePath": "README.md" } }
                ]
            },
            {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tool-1",
                    "content": [{ "type": "text", "text": "contents" }]
                }]
            },
            {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tool-2",
                    "is_error": true,
                    "content": "Tool was skipped and didn't run. The reason for skipping the tool was:\nread-only mode"
                }]
            },
            {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tool-3",
                    "is_error": true,
                    "content": "Error: bad json"
                }]
            }
        ])
    );
}

#[test]
fn lowers_unsupported_images_to_text_placeholders_without_vision_modality() {
    let messages = anthropic_messages_from_ts_ir(
        &[json!({
            "role": "lowered-checkpoint",
            "content": [{ "type": "image", "image": { "mimeType": "image/png", "base64Data": "abc" } }]
        })],
        Some(&["text".into()]),
    )
    .expect("typescript ir should lower to anthropic messages");

    assert_eq!(
        messages,
        json!([{ "role": "user", "content": [{ "type": "text", "text": "[An image was attached here. Since images are not supported by your model, the source to the image is omitted. There might be future context that allows you to make a guess about what the image was, so keep that in mind as you process the rest of the messages.]" }] }])
    );
}
