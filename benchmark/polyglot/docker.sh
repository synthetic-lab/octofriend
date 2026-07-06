#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bench_dir="${OCTOFWEN_BENCHMARK_DIR:-$repo_root/tmp.benchmarks}"
image="${OCTOFWEN_POLYGLOT_IMAGE:-octofwen-polyglot-benchmark}"

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

if [ -n "${OCTOFWEN_CONFIG:-}" ]; then
  env_args+=(--env OCTOFWEN_CONFIG=/config/octofwen.json5 --volume "$OCTOFWEN_CONFIG:/config/octofwen.json5:ro")
fi

if [ -d "$HOME/.config/octofwen" ]; then
  env_args+=(--volume "$HOME/.config/octofwen:/root/.config/octofwen:ro")
fi
if [ -d "$HOME/.octofwen" ]; then
  env_args+=(--volume "$HOME/.octofwen:/root/.octofwen:ro")
fi

docker run \
  --rm \
  --memory=12g \
  --memory-swap=12g \
  --add-host=host.docker.internal:host-gateway \
  --volume "$repo_root:/octofwen" \
  --volume "$bench_dir:/benchmarks" \
  --workdir /octofwen \
  "${env_args[@]}" \
  "$image" \
  bash -lc 'set -euo pipefail; CARGO_TARGET_DIR=/benchmarks/octofwen-target cargo build --manifest-path /octofwen/crates/octofwen-agent/Cargo.toml --bin octofwen-agentd --release; export OCTOFWEN_AGENTD=/benchmarks/octofwen-target/release/octofwen-agentd; rm -rf /tmp/octofwen-polyglot-source; git clone --depth 1 https://github.com/Aider-AI/polyglot-benchmark /tmp/octofwen-polyglot-source; exec bun benchmark/polyglot/octofwen-polyglot.ts --exercises-dir /tmp/octofwen-polyglot-source --purge-exercises-dir-before-run --benchmarks-dir /benchmarks "$@"' \
  octofwen-polyglot \
  "$@"
