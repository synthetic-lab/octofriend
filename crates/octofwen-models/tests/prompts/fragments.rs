use octofwen_models::prompts::{image_attachment_placeholder_text, tool_skip};

#[test]
fn tool_skip_renders_skipped_tool_reason() {
    assert_eq!(
        tool_skip("read-only mode"),
        "Tool was skipped and didn't run. The reason for skipping the tool was:\nread-only mode"
    );
}

#[test]
fn image_attachment_placeholder_text_renders_unsupported_image_notice() {
    assert_eq!(
        image_attachment_placeholder_text(),
        "[An image was attached here. Since images are not supported by your model, the source to the image is omitted. There might be future context that allows you to make a guess about what the image was, so keep that in mind as you process the rest of the messages.]"
    );
}
