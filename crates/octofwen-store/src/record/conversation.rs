#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConversationHistoryRecord {
    pub id: i64,
    pub kind: ConversationHistoryKind,
    pub payload: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConversationHistoryKind {
    LlmIr,
    RequestFailed,
    CompactionFailed,
    Notification,
}

impl ConversationHistoryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LlmIr => "llm-ir",
            Self::RequestFailed => "request-failed",
            Self::CompactionFailed => "compaction-failed",
            Self::Notification => "notification",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "llm-ir" => Some(Self::LlmIr),
            "request-failed" => Some(Self::RequestFailed),
            "compaction-failed" => Some(Self::CompactionFailed),
            "notification" => Some(Self::Notification),
            _ => None,
        }
    }
}
