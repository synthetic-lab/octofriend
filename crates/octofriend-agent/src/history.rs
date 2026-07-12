use octofriend_store::record::conversation::{ConversationHistoryKind, ConversationHistoryRecord};
use octofriend_store::repo::history::{ConversationHistoryOptions, ConversationHistoryRepository};
use octofriend_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationHistoryParams {
    database_path: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationHistoryAppendParams {
    database_path: Option<PathBuf>,
    entry: ConversationHistoryEntryParam,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum ConversationHistoryEntryParam {
    LlmIr { payload: String },
    RequestFailed,
    CompactionFailed,
    Notification { payload: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationSessionCreateParams {
    database_path: PathBuf,
    session_id: String,
    cwd: String,
    launch_json: String,
    timestamp: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationSessionReplaceParams {
    database_path: PathBuf,
    records: Vec<ConversationHistoryEntryParam>,
    parent_revision_id: Option<i64>,
    timestamp: i64,
}

pub(super) fn conversation_session_create_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConversationSessionCreateParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let repository = match open_repository(Some(params.database_path)) {
        Ok(repository) => repository,
        Err(error) => return storage_error(id, error),
    };
    match repository.create_session(
        &params.session_id,
        &params.cwd,
        &params.launch_json,
        params.timestamp,
    ) {
        Ok(()) => create_json_rpc_success(id, json!({})),
        Err(error) => storage_error(id, error),
    }
}

pub(super) fn conversation_session_load_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Ok(params) = parse_params(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let repository = match open_repository(params.database_path) {
        Ok(repository) => repository,
        Err(error) => return storage_error(id, error),
    };
    let metadata = match repository.session_metadata() {
        Ok(Some(metadata)) => metadata,
        Ok(None) => {
            return create_json_rpc_error(id, INVALID_PARAMS, "Session not found", None);
        }
        Err(error) => return storage_error(id, error),
    };
    match repository.latest_revision_records() {
        Ok((revision_id, records)) => create_json_rpc_success(
            id,
            json!({
                "metadata": {
                    "sessionId": metadata.session_id,
                    "cwd": metadata.cwd,
                    "launchJson": metadata.launch_json,
                    "createdAt": metadata.created_at,
                    "updatedAt": metadata.updated_at,
                },
                "revisionId": revision_id,
                "records": records.into_iter().map(conversation_history_record_json).collect::<Vec<_>>(),
            }),
        ),
        Err(error) => storage_error(id, error),
    }
}

pub(super) fn conversation_session_replace_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConversationSessionReplaceParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let repository = match open_repository(Some(params.database_path)) {
        Ok(repository) => repository,
        Err(error) => return storage_error(id, error),
    };
    let records = params
        .records
        .into_iter()
        .map(conversation_history_record)
        .collect::<Vec<_>>();
    match repository.append_revision(&records, params.parent_revision_id, params.timestamp) {
        Ok(revision_id) => create_json_rpc_success(id, json!({ "revisionId": revision_id })),
        Err(error) => storage_error(id, error),
    }
}

fn conversation_history_record(entry: ConversationHistoryEntryParam) -> ConversationHistoryRecord {
    match entry {
        ConversationHistoryEntryParam::LlmIr { payload } => ConversationHistoryRecord {
            id: 0,
            kind: ConversationHistoryKind::LlmIr,
            payload: Some(payload),
        },
        ConversationHistoryEntryParam::RequestFailed => ConversationHistoryRecord {
            id: 0,
            kind: ConversationHistoryKind::RequestFailed,
            payload: None,
        },
        ConversationHistoryEntryParam::CompactionFailed => ConversationHistoryRecord {
            id: 0,
            kind: ConversationHistoryKind::CompactionFailed,
            payload: None,
        },
        ConversationHistoryEntryParam::Notification { payload } => ConversationHistoryRecord {
            id: 0,
            kind: ConversationHistoryKind::Notification,
            payload: Some(payload),
        },
    }
}

pub(super) fn conversation_history_append_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ConversationHistoryAppendParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let repository = match open_repository(params.database_path) {
        Ok(repository) => repository,
        Err(error) => return storage_error(id, error),
    };
    let result = match params.entry {
        ConversationHistoryEntryParam::LlmIr { payload } => repository.append_llm_ir(&payload),
        ConversationHistoryEntryParam::RequestFailed => repository.append_request_failed(),
        ConversationHistoryEntryParam::CompactionFailed => repository.append_compaction_failed(),
        ConversationHistoryEntryParam::Notification { payload } => {
            repository.append_notification(&payload)
        }
    };
    match result {
        Ok(()) => create_json_rpc_success(id, json!({})),
        Err(error) => storage_error(id, error),
    }
}

pub(super) fn conversation_history_records_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Ok(params) = parse_params(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let repository = match open_repository(params.database_path) {
        Ok(repository) => repository,
        Err(error) => return storage_error(id, error),
    };
    match repository.records() {
        Ok(records) => create_json_rpc_success(
            id,
            json!({
                "records": records.into_iter().map(conversation_history_record_json).collect::<Vec<_>>()
            }),
        ),
        Err(error) => storage_error(id, error),
    }
}

pub(super) fn conversation_history_llm_payloads_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Ok(params) = parse_params(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let repository = match open_repository(params.database_path) {
        Ok(repository) => repository,
        Err(error) => return storage_error(id, error),
    };
    match repository.llm_ir_payloads() {
        Ok(payloads) => create_json_rpc_success(id, json!({ "payloads": payloads })),
        Err(error) => storage_error(id, error),
    }
}

fn parse_params(params: Option<Value>) -> Result<ConversationHistoryParams, ()> {
    let params = params.unwrap_or_else(|| json!({}));
    serde_json::from_value::<ConversationHistoryParams>(params).map_err(|_| ())
}

fn open_repository(
    database_path: Option<PathBuf>,
) -> octofriend_store::sqlite::connection::StorageResult<ConversationHistoryRepository> {
    ConversationHistoryRepository::open(ConversationHistoryOptions { database_path })
}

fn storage_error(
    id: JsonRpcId,
    error: octofriend_store::sqlite::connection::StorageError,
) -> JsonRpcResponse {
    create_json_rpc_error(
        id,
        INVALID_PARAMS,
        "Invalid params",
        Some(json!({ "message": error.to_string() })),
    )
}

fn conversation_history_record_json(record: ConversationHistoryRecord) -> Value {
    json!({
        "id": record.id,
        "kind": conversation_history_kind_json(record.kind),
        "payload": record.payload,
    })
}

fn conversation_history_kind_json(kind: ConversationHistoryKind) -> &'static str {
    kind.as_str()
}
