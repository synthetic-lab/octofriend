use serde::{Deserialize, Serialize};

use crate::ids::MessageId;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub id: MessageId,
    pub role: MessageRole,
    pub text: String,
}
