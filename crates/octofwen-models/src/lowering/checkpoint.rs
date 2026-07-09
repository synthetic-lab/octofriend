use crate::request_ir::LlmIr;

pub fn lower_checkpointed_ir(messages: &[LlmIr]) -> Result<Vec<LlmIr>, String> {
    let mut output = Vec::new();

    for ir in slice_from_most_recent_checkpoint(messages) {
        match ir {
            LlmIr::Checkpoint { content } => {
                output.push(LlmIr::LoweredCheckpoint {
                    content: content.clone(),
                });
            }
            LlmIr::Trajectory => {
                return Err(
                    "Subagent trajectory entries cannot be lowered by checkpoint lowering".into(),
                );
            }
            message => output.push(message.clone()),
        }
    }

    Ok(output)
}

fn slice_from_most_recent_checkpoint(messages: &[LlmIr]) -> &[LlmIr] {
    let Some(index) = messages
        .iter()
        .rposition(|message| matches!(message, LlmIr::Checkpoint { .. }))
    else {
        return messages;
    };

    &messages[index..]
}
