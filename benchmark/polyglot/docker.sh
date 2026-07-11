#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bench_dir="${octofriend_BENCHMARK_DIR:-$repo_root/tmp.benchmarks}"
image="${octofriend_POLYGLOT_IMAGE:-octofriend-polyglot-benchmark}"

mkdir -p "$bench_dir"

docker build \
  --file "$repo_root/benchmark/polyglot/Dockerfile" \
  --tag "$image" \
  "$repo_root"

env_args=()
while IFS='=' read -r name _; do
  case "$name" in
    OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|XAI_API_KEY|SYNTHETIC_API_KEY)
      env_args+=(--env "$name")
      ;;
  esac
done < <(env)

if [ -n "${octofriend_CONFIG:-}" ]; then
  env_args+=(--env octofriend_CONFIG=/config/octofriend.json5 --volume "$octofriend_CONFIG:/config/octofriend.json5:ro")
fi

if [ -d "$HOME/.config/octofriend" ]; then
  env_args+=(--volume "$HOME/.config/octofriend:/root/.config/octofriend:ro")
fi
if [ -d "$HOME/.octofriend" ]; then
  env_args+=(--volume "$HOME/.octofriend:/root/.octofriend:ro")
fi

docker run \
  --rm \
  --memory=12g \
  --memory-swap=12g \
  --add-host=host.docker.internal:host-gateway \
  --volume "$repo_root:/octofriend" \
  --volume "$bench_dir:/benchmarks" \
  --workdir /octofriend \
  "${env_args[@]}" \
  "$image" \
  bash -lc 'set -euo pipefail; CARGO_TARGET_DIR=/benchmarks/octofriend-target cargo build --manifest-path /octofriend/crates/octofriend-agent/Cargo.toml --bin octofriend-agentd --release; export octofriend_AGENTD=/benchmarks/octofriend-target/release/octofriend-agentd; rm -rf /tmp/octofriend-polyglot-source; git clone --depth 1 https://github.com/Aider-AI/polyglot-benchmark /tmp/octofriend-polyglot-source; exec bun benchmark/polyglot/octofriend-polyglot.ts --exercises-dir /tmp/octofriend-polyglot-source --purge-exercises-dir-before-run --benchmarks-dir /benchmarks "$@"' \
  octofriend-polyglot \
  "$@"
