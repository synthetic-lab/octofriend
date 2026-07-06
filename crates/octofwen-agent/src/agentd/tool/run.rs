use std::path::PathBuf;

use octofwen_protocol::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use octofwen_tools::runtime::{RuntimeToolTransport, run_runtime_tool_call_with_transport};
use serde::Deserialize;
use serde_json::{Value, json};

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolRunParams {
    tool_name: String,
    cwd: PathBuf,
    transport: Option<ToolRunTransport>,
    tool_call_id: String,
    tool_call: Value,
    parsed: Value,
    model_context: Option<usize>,
    mcp_servers: Option<Value>,
    lsp: Option<Value>,
    web_search: Option<Value>,
    user_name: Option<String>,
    skills: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum ToolRunTransport {
    Local,
    Docker { container: String },
}

impl ToolRunTransport {
    fn into_runtime(self, cwd: PathBuf) -> RuntimeToolTransport {
        match self {
            Self::Local => RuntimeToolTransport::local(cwd),
            Self::Docker { container } => {
                RuntimeToolTransport::docker(container, cwd.to_string_lossy())
            }
        }
    }
}

pub(in crate::agentd) fn tool_run_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ToolRunParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let mut parsed = params.parsed;
    if let Some(model_context) = params.model_context {
        if let Some(object) = parsed.as_object_mut() {
            object.insert("modelContext".into(), json!(model_context));
        }
    }
    if let Some(mcp_servers) = params.mcp_servers {
        if let Some(object) = parsed.as_object_mut() {
            object.insert("mcpServers".into(), mcp_servers);
        }
    }
    if let Some(lsp) = params.lsp {
        if let Some(object) = parsed.as_object_mut() {
            object.insert("lsp".into(), lsp);
        }
    }
    if let Some(web_search) = params.web_search {
        if let Some(object) = parsed.as_object_mut() {
            if let Some(search_url) = web_search.get("searchUrl") {
                object.insert("searchUrl".into(), search_url.clone());
            }
            if let Some(search_key) = web_search.get("searchKey") {
                object.insert("searchKey".into(), search_key.clone());
            }
        }
    }
    if let Some(user_name) = params.user_name {
        if let Some(object) = parsed.as_object_mut() {
            object.insert("userName".into(), json!(user_name));
        }
    }
    if let Some(skills) = params.skills {
        if let Some(object) = parsed.as_object_mut() {
            object.insert("skills".into(), skills);
        }
    }

    let transport = params
        .transport
        .map(|transport| transport.into_runtime(params.cwd.clone()))
        .unwrap_or_else(|| RuntimeToolTransport::local(&params.cwd));

    match run_runtime_tool_call_with_transport(
        &params.tool_name,
        transport,
        &params.tool_call_id,
        &params.tool_call,
        &parsed,
    ) {
        Ok(result) => create_json_rpc_success(
            id,
            json!({
                "status": "completed",
                "result": result,
            }),
        ),
        Err(error) => create_json_rpc_success(
            id,
            json!({
                "status": "error",
                "message": error,
            }),
        ),
    }
}
