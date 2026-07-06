use crate::ir::LlmIr;

use super::checkpoint::lower_checkpointed_ir;

pub fn lower_tool_rejects(messages: &[LlmIr]) -> Vec<LlmIr> {
    messages
        .iter()
        .map(|message| match message {
            LlmIr::ToolReject { tool_call } => LlmIr::ToolSkipOutput {
                tool_call: tool_call.clone(),
                reason: "Tool call rejected by user.".into(),
            },
            message => message.clone(),
        })
        .collect()
}

pub fn lower_octo_ir(messages: &[LlmIr]) -> Result<Vec<LlmIr>, String> {
    lower_checkpointed_ir(&lower_tool_rejects(messages))
}
