use env as safe_env;
use std::path::{Path, PathBuf};

use octofwen_tools::skills::{AgentSkillHost, DirectoryEntry, discover_skills};
use octofwen_wire::json_rpc::{
    JsonRpcId, JsonRpcResponse, create_json_rpc_error, create_json_rpc_success,
};
use serde::Deserialize;
use serde_json::{Value, json};

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillDiscoverParams {
    cwd: PathBuf,
    home: PathBuf,
    #[serde(default)]
    configured_skill_paths: Vec<String>,
}

pub(super) fn skill_discover_response(id: JsonRpcId, params: Option<Value>) -> JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<SkillDiscoverParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let host = StdSkillHost {
        cwd: path_string(&params.cwd),
        home: path_string(&params.home),
    };
    let skills = discover_skills(&host, &params.configured_skill_paths, |_| {});

    create_json_rpc_success(
        id,
        json!({
            "skills": skills.into_iter().map(|skill| {
                json!({
                    "name": skill.name,
                    "description": skill.description,
                    "license": skill.license,
                    "compatibility": skill.compatibility,
                    "metadata": skill.metadata,
                    "instructions": skill.instructions,
                    "path": skill.path,
                    "skillFilePath": skill.skill_file_path,
                })
            }).collect::<Vec<_>>(),
        }),
    )
}

struct StdSkillHost {
    cwd: String,
    home: String,
}

impl AgentSkillHost for StdSkillHost {
    fn cwd(&self) -> &str {
        &self.cwd
    }

    fn get_env_var(&self, name: &str) -> String {
        if name == "HOME" {
            self.home.clone()
        } else {
            safe_env::var(name).unwrap_or_default()
        }
    }

    fn path_exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    fn read_file(&self, path: &str) -> Result<String, String> {
        std::fs::read_to_string(path).map_err(|error| error.to_string())
    }

    fn read_dir(&self, path: &str) -> Result<Vec<DirectoryEntry>, String> {
        let entries = std::fs::read_dir(path).map_err(|error| error.to_string())?;
        let mut output = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            output.push(DirectoryEntry {
                entry: entry.file_name().to_string_lossy().into_owned(),
                is_directory: entry
                    .file_type()
                    .map_err(|error| error.to_string())?
                    .is_dir(),
            });
        }
        output.sort_by(|left, right| left.entry.cmp(&right.entry));
        Ok(output)
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
