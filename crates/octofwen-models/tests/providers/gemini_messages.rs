use octofwen_models::providers::gemini_contents_from_ts_ir;
use serde_json::json;

#[test]
fn lowers_typescript_ir_into_gemini_contents() {
    let contents = gemini_contents_from_ts_ir(
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
                "toolCalls": [{
                    "type": "tool-call",
                    "toolCallId": "call-1",
                    "name": "read",
                    "original": { "path": "README.md" }
                }],
                "gemini": {
                    "thoughtSignatures": [{
                        "partIndex": 1,
                        "toolCallId": "call-1",
                        "thoughtSignature": "sig-1"
                    }]
                }
            }),
            json!({
                "role": "tool-output",
                "toolCall": {
                    "toolCallId": "call-1",
                    "name": "read"
                },
                "content": [{ "type": "text", "content": "contents" }]
            }),
            json!({
                "role": "tool-runtime-error",
                "toolCall": {
                    "toolCallId": "call-2",
                    "name": "write"
                },
                "error": "boom"
            }),
        ],
        Some(&["vision".into()]),
    )
    .expect("typescript ir should lower to gemini contents");

    assert_eq!(
        contents,
        json!([
            {
                "role": "user",
                "parts": [
                    { "text": "hello" },
                    { "inlineData": { "mimeType": "image/png", "data": "abc" } }
                ]
            },
            {
                "role": "model",
                "parts": [
                    { "text": "answer" },
                    {
                        "functionCall": { "id": "call-1", "name": "read", "args": { "path": "README.md" } },
                        "thoughtSignature": "sig-1"
                    }
                ]
            },
            {
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "id": "call-1",
                        "name": "read",
                        "response": { "output": "contents" }
                    }
                }]
            },
            {
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "id": "call-2",
                        "name": "write",
                        "response": { "error": "Error: boom" }
                    }
                }]
            }
        ])
    );
}

#[test]
fn lowers_unsupported_gemini_images_to_text_placeholders_without_vision_modality() {
    let contents = gemini_contents_from_ts_ir(
        &[json!({
            "role": "lowered-checkpoint",
            "content": [{ "type": "image", "image": { "mimeType": "image/png", "base64Data": "abc" } }]
        })],
        Some(&["text".into()]),
    )
    .expect("typescript ir should lower to gemini contents");

    assert_eq!(
        contents,
        json!([{ "role": "user", "parts": [{ "text": "[An image was attached here. Since images are not supported by your model, the source to the image is omitted. There might be future context that allows you to make a guess about what the image was, so keep that in mind as you process the rest of the messages.]" }] }])
    );
}
