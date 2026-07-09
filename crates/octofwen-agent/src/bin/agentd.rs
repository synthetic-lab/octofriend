use env as _;
use ignore as _;
use json5 as _;
use octofwen_agent::runtime::run_agentd_jsonl;
use octofwen_config as _;
use octofwen_models as _;
use octofwen_store as _;
use octofwen_text as _;
use octofwen_tools as _;
use octofwen_wire as _;
use octofwen_workspace as _;
use reqwest as _;
use serde as _;
use serde_json as _;
use std::io;

fn main() -> Result<(), io::Error> {
    run_agentd_jsonl(io::stdin().lock(), io::stdout().lock())
}
