use octofwen_agent::runtime::{AGENTD_SKILL_DISCOVER_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn skill_discover_request_returns_discovered_skills() {
    let root = unique_temp_dir("octofwen-agentd-skill-discovery");
    let skill_dir = root.join(".agents").join("skills").join("project-skill");
    std::fs::create_dir_all(&skill_dir).expect("skill dir should be created");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: project-skill\ndescription: Project skill.\n---\n\nUse this skill.\n",
    )
    .expect("skill file should be written");

    let line = json!({
        "jsonrpc": "2.0",
        "id": "skill-discover",
        "method": AGENTD_SKILL_DISCOVER_METHOD,
        "params": {
            "cwd": root,
            "home": root.join("home"),
            "configuredSkillPaths": []
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    let skill = &value["result"]["skills"][0];
    assert_eq!(skill["name"], "project-skill");
    assert_eq!(skill["description"], "Project skill.");
    assert_eq!(skill["license"], json!(null));
    assert_eq!(skill["compatibility"], json!(null));
    assert_eq!(skill["instructions"], "Use this skill.");
    assert_eq!(
        skill["path"]
            .as_str()
            .expect("skill path should be a string")
            .replace('\\', "/"),
        skill_dir.display().to_string().replace('\\', "/")
    );
    assert_eq!(
        skill["skillFilePath"]
            .as_str()
            .expect("skill file path should be a string")
            .replace('\\', "/"),
        skill_dir
            .join("SKILL.md")
            .display()
            .to_string()
            .replace('\\', "/")
    );
    assert_eq!(skill["metadata"], json!({}));

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

fn unique_temp_dir(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos()
    ))
}
