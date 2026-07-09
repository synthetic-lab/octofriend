use octofwen_agent::runtime::{AGENTD_TOOL_DEFINITIONS_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn tool_definitions_request_returns_agentd_builtin_tool_contracts() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-definitions",
        "method": AGENTD_TOOL_DEFINITIONS_METHOD,
        "params": {
            "hasMcpServers": true,
            "hasWebSearch": true
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    let definitions = value["result"]["tools"]
        .as_array()
        .expect("tool definitions should be an array");
    let names = definitions
        .iter()
        .map(|definition| {
            definition["name"]
                .as_str()
                .expect("tool should have a name")
        })
        .collect::<Vec<_>>();

    assert!(names.contains(&"read"));
    assert!(names.contains(&"edit"));
    assert!(names.contains(&"create"));
    assert!(names.contains(&"rewrite"));
    assert!(names.contains(&"shell"));
    assert!(names.contains(&"list"));
    assert!(names.contains(&"glob"));
    assert!(names.contains(&"grep"));
    assert!(names.contains(&"fetch"));
    assert!(names.contains(&"web-search"));
    assert!(names.contains(&"mcp"));
    assert!(names.contains(&"lsp-definition"));
    assert!(names.contains(&"lsp-document-symbol"));

    let read = definitions
        .iter()
        .find(|definition| definition["name"] == "read")
        .expect("read definition should be present");
    assert_eq!(read["argumentsSchema"]["required"], json!(["filePath"]));
    assert_eq!(
        read["argumentsSchema"]["properties"]["filePath"]["type"],
        "string"
    );
}

#[test]
fn tool_definitions_request_omits_configured_dynamic_tools_when_unavailable() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-definitions",
        "method": AGENTD_TOOL_DEFINITIONS_METHOD,
        "params": {
            "hasMcpServers": false,
            "hasWebSearch": false
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    let names = value["result"]["tools"]
        .as_array()
        .expect("tool definitions should be an array")
        .iter()
        .map(|definition| {
            definition["name"]
                .as_str()
                .expect("tool should have a name")
        })
        .collect::<Vec<_>>();

    assert!(!names.contains(&"web-search"));
    assert!(!names.contains(&"mcp"));
}

#[test]
fn tool_definitions_request_includes_agentd_skill_tool_when_skills_are_available() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-definitions-skills",
        "method": AGENTD_TOOL_DEFINITIONS_METHOD,
        "params": {
            "hasMcpServers": false,
            "hasWebSearch": false,
            "skills": [
                {
                    "name": "review-code",
                    "description": "Reviews source changes.",
                    "license": null,
                    "compatibility": null,
                    "metadata": {},
                    "instructions": "Inspect the diff before commenting.",
                    "path": "/skills/review-code",
                    "skillFilePath": "/skills/review-code/SKILL.md"
                }
            ]
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");
    let definitions = value["result"]["tools"]
        .as_array()
        .expect("tool definitions should be an array");
    let skill = definitions
        .iter()
        .find(|definition| definition["name"] == "skill")
        .expect("skill definition should be present");

    assert!(
        skill["description"]
            .as_str()
            .expect("description should be a string")
            .contains("review-code")
    );
    assert_eq!(
        skill["argumentsSchema"]["properties"]["skillName"]["enum"],
        json!(["review-code"])
    );
}
