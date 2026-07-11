use octofriend_store::record::conversation::ConversationHistoryKind;
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
                "records": records.into_iter().map(|record| json!({
                    "id": record.id,
                    "kind": conversation_history_kind_json(record.kind),
                    "payload": record.payload,
                })).collect::<Vec<_>>()
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

fn conversation_history_kind_json(kind: ConversationHistoryKind) -> &'static str {
    kind.as_str()
}
