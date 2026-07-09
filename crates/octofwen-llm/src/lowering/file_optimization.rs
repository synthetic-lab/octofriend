use std::collections::HashSet;

use crate::ir::{ContentPart, ImageInfo, LlmIr};

#[derive(Clone, Debug, PartialEq)]
pub struct ImageModalityConfig {
    pub enabled: bool,
    pub max_size_mb: f64,
    pub accepted_mime_types: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MultimodalConfig {
    pub image: Option<ImageModalityConfig>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CanDisplayImageResult {
    Accepted,
    Rejected { reason: String },
}

pub fn optimize_files(messages: &[LlmIr], modalities: Option<&MultimodalConfig>) -> Vec<LlmIr> {
    let mut output = Vec::new();
    let mut seen_paths = HashSet::new();

    for ir in messages.iter().rev() {
        output.push(optimize_file_ir(ir, &mut seen_paths, modalities));
    }

    output.reverse();
    output
}

pub fn can_display_image(
    modalities: Option<&MultimodalConfig>,
    image: &ImageInfo,
) -> CanDisplayImageResult {
    let Some(image_config) = modalities.and_then(|modalities| modalities.image.as_ref()) else {
        return CanDisplayImageResult::Rejected {
            reason: "Your model does not support image viewing.".into(),
        };
    };
    if !image_config.enabled {
        return CanDisplayImageResult::Rejected {
            reason: "Your model does not support image viewing.".into(),
        };
    }
    if !image_config
        .accepted_mime_types
        .iter()
        .any(|mime_type| mime_type == &image.mime_type)
    {
        return CanDisplayImageResult::Rejected {
            reason: format!(
                "Your model does not support {} images. Supported formats: {}.",
                image.mime_type,
                image_config.accepted_mime_types.join(", ")
            ),
        };
    }
    if let Some(size_bytes) = image.size_bytes {
        if size_bytes > max_size_bytes(image_config.max_size_mb) {
            return CanDisplayImageResult::Rejected {
                reason: format!(
                    "Image file is too large ({} MB). Maximum supported size is {} MB.",
                    format_size_mb(size_bytes),
                    format_max_size_mb(image_config.max_size_mb)
                ),
            };
        }
    }

    CanDisplayImageResult::Accepted
}

fn optimize_file_ir(
    ir: &LlmIr,
    seen_paths: &mut HashSet<String>,
    modalities: Option<&MultimodalConfig>,
) -> LlmIr {
    match ir {
        LlmIr::FileRead {
            path,
            content,
            tool_call,
            image,
        } => {
            let seen_path = seen_paths.contains(path);
            seen_paths.insert(path.clone());

            let image_check = image
                .as_ref()
                .map(|image| can_display_image(modalities, image));
            if let (Some(image), Some(CanDisplayImageResult::Accepted)) = (image, &image_check) {
                return LlmIr::User {
                    content: vec![
                        ContentPart::Text {
                            content: format!(
                                "[Tool result for call {}]: {content}",
                                tool_call.tool_call_id
                            ),
                        },
                        ContentPart::Image {
                            image: image.clone(),
                        },
                    ],
                };
            }

            LlmIr::ToolOutput {
                tool_call: tool_call.clone(),
                content: vec![ContentPart::Text {
                    content: file_read_message(content, seen_path, image_check.as_ref()),
                }],
            }
        }
        LlmIr::FileMutate {
            path, tool_call, ..
        } => LlmIr::ToolOutput {
            tool_call: tool_call.clone(),
            content: vec![ContentPart::Text {
                content: file_mutation_message(path),
            }],
        },
        ir => ir.clone(),
    }
}

fn file_mutation_message(file_path: &str) -> String {
    format!("{file_path} was updated successfully.")
}

fn file_read_message(
    content: &str,
    seen_path: bool,
    image_check: Option<&CanDisplayImageResult>,
) -> String {
    match image_check {
        Some(CanDisplayImageResult::Rejected { reason }) => {
            format!(
                "{content}\n[An image file was read but could not be displayed: {reason} The image content has been omitted.]"
            )
        }
        _ if seen_path => "File was successfully read.".into(),
        _ => content.into(),
    }
}

fn max_size_bytes(max_size_mb: f64) -> u64 {
    if !max_size_mb.is_finite() {
        return u64::MAX;
    }
    if max_size_mb <= 0.0 {
        return 0;
    }
    format!("{:.0}", (max_size_mb * 1_048_576.0).ceil())
        .parse()
        .unwrap_or(u64::MAX)
}

fn format_size_mb(size_bytes: u64) -> String {
    let tenths = (size_bytes.saturating_mul(10) + 524_288) / 1_048_576;
    format!("{}.{:01}", tenths / 10, tenths % 10)
}

fn format_max_size_mb(max_size_mb: f64) -> String {
    if max_size_mb.fract() == 0.0 {
        format!("{max_size_mb:.0}")
    } else {
        max_size_mb.to_string()
    }
}
