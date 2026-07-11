use octofriend_wire::json_rpc::{
    JSON_RPC_VERSION, JsonRpcErrorObject, JsonRpcId, JsonRpcMessageKind, JsonRpcResponse,
    classify_json_rpc_message, create_json_rpc_error, create_json_rpc_notification,
    create_json_rpc_request, create_json_rpc_success,
};
use serde as _;
use serde_json::json;

#[test]
fn creates_json_rpc_2_request_and_notification() {
    let request = create_json_rpc_request(
        JsonRpcId::Number(1),
        "initialize",
        Some(json!({"cwd":"/repo"})),
    );
    assert_eq!(request.jsonrpc, JSON_RPC_VERSION);
    assert_eq!(request.id, JsonRpcId::Number(1));
    assert_eq!(request.method, "initialize");
    assert_eq!(request.params, Some(json!({"cwd":"/repo"})));

    let notification =
        create_json_rpc_notification("session/update", Some(json!({"sessionId":"s1"})));
    assert_eq!(notification.jsonrpc, JSON_RPC_VERSION);
    assert_eq!(notification.method, "session/update");
    assert_eq!(notification.params, Some(json!({"sessionId":"s1"})));
}

#[test]
fn creates_success_and_error_responses() {
    let success =
        create_json_rpc_success(JsonRpcId::String("req-1".to_owned()), json!({"ok":true}));
    assert_eq!(
        success,
        JsonRpcResponse::Success {
            jsonrpc: JSON_RPC_VERSION,
            id: JsonRpcId::String("req-1".to_owned()),
            result: json!({"ok":true}),
        }
    );

    let error = create_json_rpc_error(
        JsonRpcId::String("req-1".to_owned()),
        -32602,
        "Invalid params",
        Some(json!({"field":"cwd"})),
    );
    assert_eq!(
        error,
        JsonRpcResponse::Error {
            jsonrpc: JSON_RPC_VERSION,
            id: JsonRpcId::String("req-1".to_owned()),
            error: JsonRpcErrorObject {
                code: -32602,
                message: "Invalid params".to_owned(),
                data: Some(json!({"field":"cwd"})),
            },
        }
    );
}

#[test]
fn classifies_request_notification_and_response_envelopes() {
    assert_eq!(
        classify_json_rpc_message(&json!({"jsonrpc":"2.0","id":"1","method":"initialize"})),
        Some(JsonRpcMessageKind::Request)
    );
    assert_eq!(
        classify_json_rpc_message(&json!({"jsonrpc":"2.0","method":"session/update"})),
        Some(JsonRpcMessageKind::Notification)
    );
    assert_eq!(
        classify_json_rpc_message(&json!({"jsonrpc":"2.0","id":"1","result":null})),
        Some(JsonRpcMessageKind::Response)
    );
    assert_eq!(
        classify_json_rpc_message(&json!({"jsonrpc":"1.0","id":"1","method":"initialize"})),
        None
    );
}
