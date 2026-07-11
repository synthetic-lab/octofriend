use env as _;
use ignore as _;
use json5 as _;
use octofriend_agent::runtime::run_agentd_jsonl;
use octofriend_config as _;
use octofriend_models as _;
use octofriend_store as _;
use octofriend_text as _;
use octofriend_tools as _;
use octofriend_wire as _;
use octofriend_workspace as _;
use reqwest as _;
use serde as _;
use serde_json as _;
use std::io;

fn main() -> Result<(), io::Error> {
    run_agentd_jsonl(io::stdin().lock(), io::stdout().lock())
}
