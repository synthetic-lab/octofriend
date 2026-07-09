use env as _;
use ignore as _;
use json5 as _;
use octofwen_agent::agentd::run_agentd_jsonl;
use octofwen_config as _;
use octofwen_core as _;
use octofwen_llm as _;
use octofwen_protocol as _;
use octofwen_storage as _;
use octofwen_tools as _;
use octofwen_transport as _;
use reqwest as _;
use serde as _;
use serde_json as _;
use std::io;

fn main() -> Result<(), io::Error> {
    run_agentd_jsonl(io::stdin().lock(), io::stdout().lock())
}
