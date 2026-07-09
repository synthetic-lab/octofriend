use octofwen_models::lowering::{
    CanDisplayImageResult, ImageModalityConfig, MultimodalConfig, can_display_image, optimize_files,
};
use octofwen_models::request_ir::{ContentPart, ImageInfo, LlmIr, ToolCall};
use serde_json::json;

fn tool_call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        tool_call_id: id.into(),
        name: name.into(),
        original: json!({ "filePath": "/tmp/a.txt" }),
        parsed: json!({ "filePath": "/tmp/a.txt" }),
    }
}

fn mutate_tool_call(id: &str) -> ToolCall {
    ToolCall {
        tool_call_id: id.into(),
        name: "rewrite".into(),
        original: json!({ "filePath": "/tmp/a.txt", "text": "" }),
        parsed: json!({ "filePath": "/tmp/a.txt", "text": "", "originalFileContents": "idk" }),
    }
}

fn png_image(size_bytes: Option<u64>) -> ImageInfo {
    ImageInfo {
        mime_type: "image/png".into(),
        base64_data: "abc".into(),
        data_url: "data:image/png;base64,abc".into(),
        file_path: "/tmp/a.png".into(),
        size_bytes,
    }
}

#[test]
fn keeps_the_newest_read_for_a_path_and_strips_older_reads() {
    let messages = vec![
        LlmIr::FileRead {
            path: "/tmp/a.txt".into(),
            content: "old contents".into(),
            tool_call: tool_call("old", "read"),
            image: None,
        },
        LlmIr::FileRead {
            path: "/tmp/a.txt".into(),
            content: "new contents".into(),
            tool_call: tool_call("new", "read"),
            image: None,
        },
    ];

    assert_eq!(
        optimize_files(&messages, None),
        vec![
            LlmIr::ToolOutput {
                tool_call: tool_call("old", "read"),
                content: vec![ContentPart::Text {
                    content: "File was successfully read.".into(),
                }],
            },
            LlmIr::ToolOutput {
                tool_call: tool_call("new", "read"),
                content: vec![ContentPart::Text {
                    content: "new contents".into(),
                }],
            },
        ]
    );
}

#[test]
fn turns_displayable_image_reads_into_user_messages_with_images() {
    let image = png_image(Some(3));

    assert_eq!(
        optimize_files(
            &[LlmIr::FileRead {
                path: "/tmp/a.png".into(),
                content: "image contents".into(),
                tool_call: tool_call("image-read", "read"),
                image: Some(image.clone()),
            }],
            Some(&MultimodalConfig {
                image: Some(ImageModalityConfig {
                    enabled: true,
                    accepted_mime_types: vec!["image/png".into()],
                    max_size_mb: 1.0,
                }),
            }),
        ),
        vec![LlmIr::User {
            content: vec![
                ContentPart::Text {
                    content: "[Tool result for call image-read]: image contents".into(),
                },
                ContentPart::Image { image },
            ],
        }]
    );
}

#[test]
fn keeps_unreadable_image_contents_as_text_with_display_failure_reason() {
    let image = png_image(Some(2 * 1024 * 1024));

    assert_eq!(
        optimize_files(
            &[LlmIr::FileRead {
                path: "/tmp/a.png".into(),
                content: "image contents".into(),
                tool_call: tool_call("image-read", "read"),
                image: Some(image),
            }],
            Some(&MultimodalConfig {
                image: Some(ImageModalityConfig {
                    enabled: true,
                    accepted_mime_types: vec!["image/png".into()],
                    max_size_mb: 1.0,
                }),
            }),
        ),
        vec![LlmIr::ToolOutput {
            tool_call: tool_call("image-read", "read"),
            content: vec![ContentPart::Text {
                content: "image contents\n[An image file was read but could not be displayed: Image file is too large (2.0 MB). Maximum supported size is 1 MB. The image content has been omitted.]".into(),
            }],
        }]
    );
}

#[test]
fn rewrites_file_mutation_to_a_base_tool_message() {
    assert_eq!(
        optimize_files(
            &[LlmIr::FileMutate {
                path: "/tmp/a.txt".into(),
                content: "raw mutate output".into(),
                tool_call: mutate_tool_call("mutate"),
            }],
            None,
        ),
        vec![LlmIr::ToolOutput {
            tool_call: mutate_tool_call("mutate"),
            content: vec![ContentPart::Text {
                content: "/tmp/a.txt was updated successfully.".into(),
            }],
        }]
    );
}

#[test]
fn checks_whether_images_can_be_displayed() {
    assert_eq!(
        can_display_image(None, &png_image(Some(3))),
        CanDisplayImageResult::Rejected {
            reason: "Your model does not support image viewing.".into(),
        }
    );
    assert_eq!(
        can_display_image(
            Some(&MultimodalConfig {
                image: Some(ImageModalityConfig {
                    enabled: true,
                    accepted_mime_types: vec!["image/jpeg".into()],
                    max_size_mb: 1.0,
                }),
            }),
            &png_image(Some(3)),
        ),
        CanDisplayImageResult::Rejected {
            reason: "Your model does not support image/png images. Supported formats: image/jpeg."
                .into(),
        }
    );
    assert_eq!(
        can_display_image(
            Some(&MultimodalConfig {
                image: Some(ImageModalityConfig {
                    enabled: true,
                    accepted_mime_types: vec!["image/png".into()],
                    max_size_mb: 1.0,
                }),
            }),
            &png_image(Some(3)),
        ),
        CanDisplayImageResult::Accepted
    );
}
