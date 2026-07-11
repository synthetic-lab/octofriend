# TODO

All tracked items in this file are complete (update *me* if not). Each entry keeps the original request, the implemented outcome, and the command set used to verify it.

## Completed work

### Context, prompts, and trajectory control

#### [x] Add git-aware situational awareness

If the working directory is a git repository, include `.gitignore`-aware directory context in the system prompt.

- Outcome: agentd builds system prompt directory context from the filesystem when callers do not pass explicit `directoryEntries`.
- Implementation: `ignore::WalkBuilder` applies repository ignore files and standard filters. The bounded hierarchy is rendered next to the working directory in the system prompt.
- Verify:

```sh
cargo test -p octofriend-agent --test agentd system_prompt_discovers_gitignore_aware_directory_hierarchy -- --nocapture
cargo test -p octofriend-llm --test prompts system_prompt_renders_identity_workspace_listing_and_instruction_context -- --nocapture
```

#### [x] Add a forgotten-work check before returning input

Before returning control to the user, run a short internal check for missed tests, compilers, lint, result inspection, or blockers.

- Outcome: `trajectoryArc` runs a one-pass internal forgotten-check provider call before final `needs-response` answers.
- Behavior: the internal prompt is sent only to the provider, does not appear in user-visible IR, preserves the original answer if the check fails, and is skipped for retry-tool `needs-response` paths.
- Verify:

```sh
cargo test -p octofriend-agent --test agentd trajectory_arc_runs_forgotten_check_before_returning_input -- --nocapture
cargo test -p octofriend-agent --test agentd trajectory -- --nocapture
cargo fmt --all --check
```

### Provider support and model setup

#### [x] Add native Gemini API support

Gemini's OpenAI-compatible endpoint was not complete enough for Octo.

- Outcome: native `gemini` provider support exists.
- Implementation: Google Gemini catalog metadata, `streamGenerateContent?alt=sse`, `x-goog-api-key`, Gemini content/tool lowering, `parametersJsonSchema` tool declarations, stream/tool/usage parsing, Gemini 3 `thoughtSignature` round-tripping, and native Gemini model connection checks.
- Verify:

```sh
cargo test -p octofriend-llm --test providers
cargo test -p octofriend-llm --test compiler assistant_output
cargo test -p octofriend-agent --test agentd model_connection
cargo test -p octofriend-agent --test agentd provider
octofriend_AGENTD=target/debug/octofriend-agentd bun test packages/octofriend-cli/src/__tests__/bridge/rust/model-catalog.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/agent-provider.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/agent.test.ts packages/octofriend-tui/src/__tests__/internal/model-provider-catalog/model-provider-catalog.test.ts packages/octofriend-tui/src/__tests__/menu/model_setup.test.ts
```

#### [x] Configure Anthropic thinking budget by token count

Anthropic models can use explicit token budgets instead of only `minimal`/`low`/`medium`/`high`/`xhigh` presets.

- Outcome: Anthropic provider planning accepts `thinkingBudgetTokens`.
- Behavior: explicit token budgets are validated against `max_tokens` and take precedence over fixed preset mappings. Adaptive Anthropic model families use provider-specific `thinking`/`output_config` fields instead of forced token budgets.
- Verify:

```sh
cargo test -p octofriend-agent --test agentd anthropic -- --nocapture
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-cli/src/__tests__/provider-run.test.ts packages/octofriend-tui/src/__tests__/internal/agent-trajectory-runtime/agent-trajectory-runtime.test.ts
```

#### [x] Handle missing auth during model switching

Model switching should not silently select a model whose configured auth is missing or invalid.

- Outcome: model switching resolves selected-model auth through agentd before switching.
- Behavior: models with configured `apiEnvVar`/`auth` report the missing or invalid auth message instead of switching. Models without configured auth still fall back to the key-file setup prompt.
- Verify:

```sh
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/menu/app_menu.test.tsx
cargo test -p octofriend-agent --test agentd config_select_model_reports_missing_configured_env_auth -- --nocapture
```

#### [x] Add API-key links for known inference hosts

Model setup should show clickable API-key URLs for known providers, including wandb-style authorize URLs where available.

- Outcome: provider catalog metadata includes `apiKeyUrl` for Synthetic, OpenAI, Anthropic, Gemini, and xAI/Grok.
- Behavior: the model setup API-key prompt resolves the selected provider by `baseUrl` and renders an OSC 8 terminal hyperlink. Unknown custom providers omit the link.
- Verify:

```sh
cargo test -p octofriend-agent --test agentd model_provider_catalog_request_returns_agentd_provider_catalog -- --nocapture
cargo build -p octofriend-agent --bin octofriend-agentd
octofriend_AGENTD=target/debug/octofriend-agentd PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/menu/model_setup.test.ts packages/octofriend-tui/src/__tests__/internal/model-provider-catalog/model-provider-catalog.test.ts
octofriend_AGENTD=target/debug/octofriend-agentd PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-cli/src/__tests__/bridge/rust/model-catalog.test.ts
```

#### [x] Test autofix model connections before accepting setup

Autofix setup should test all supported auth sources and show billing/auth errors immediately.

- Outcome: Synthetic autofix setup tests model connectivity before accepting autofix models.
- Behavior: setup tests both default autofix models (`diff-apply` and `fix-json`), supports stored keys, configured env-var auth, custom env auth, and custom command auth, and returns connection error text to the setup UI.
- Verify:

```sh
cargo build -p octofriend-agent --bin octofriend-agentd
octofriend_AGENTD="$(pwd)/target/debug/octofriend-agentd" PATH="$HOME/.bun/bin:$PATH" bun test --timeout 30000 packages/octofriend-tui/src/__tests__/menu/model_setup.test.ts
```

### CLI prompt command

#### [x] Support Anthropic and OpenAI Responses in `octofriend prompt`

- Outcome: the prompt command resolves the selected model and delegates completion to `runCliProviderCompletion`.
- Behavior: the command forwards model `type`, reasoning settings, modalities, system prompt, API key, and prompt IR to agentd's provider compiler. Agentd supports `anthropic`, `openai-responses`, and standard OpenAI-compatible provider plans.
- Verify:

```sh
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-cli/src/__tests__/provider-run.test.ts
cargo test -p octofriend-agent --test agentd provider_compiler_complete_passes_openai_responses_xhigh_reasoning -- --nocapture
cargo test -p octofriend-agent --test agentd anthropic -- --nocapture
```

#### [x] Stream reasoning tokens to stderr

Reasoning output should not mix with content output.

- Outcome: `createTokenHandler()` writes `reasoning` events to stderr, writes `content` and `tool` events to stdout, and inserts a stderr separator before the first content token after reasoning.
- Verify:

```sh
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-cli/src/__tests__/prompt.test.ts packages/octofriend-cli/src/__tests__/provider-run.test.ts
```

### TUI routing and setup flows

#### [x] Move app menu navigation to shared Router/Back primitives

- Outcome: app-menu top-level navigation uses the shared typed `router`/`Back` primitives from the add-model flow.
- Implementation: the app-menu-only Zustand `menuMode` store was removed. Menu screens receive route callbacks through props. Model switching keeps its scoped API-key substep cancellation instead of a broad Back wrapper.
- Verify:

```sh
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/menu/app_menu.test.tsx
PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p packages/octofriend-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable
grep -R "useMenuState\|setMenuMode\|menuMode\|MenuMode\|MenuState" -n packages/octofriend-tui/src/menu/app_menu packages/octofriend-tui/src/__tests__/menu || true
```

#### [x] Move first-time setup to shared Router/Back primitives

- Outcome: first-time setup uses the shared `router`/`Back` primitives for the outer welcome/autofix/add-model/name/done routes.
- Implementation: the nested autofix setup flow has its own typed router for choose, Synthetic auth, diff-apply custom, and fix-json custom routes. The old `SetupStep`/`AutofixStates` step unions and step setters were removed. Route props carry autofix config and connection error data between screens.
- Verify:

```sh
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/app/first_time_setup/main.test.tsx
PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p packages/octofriend-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable
grep -R "SetupStep\|AutofixStates\|setAutofixStep\|setStep" -n packages/octofriend-tui/src/app/first_time_setup packages/octofriend-tui/src/__tests__/app/first_time_setup || true
```

### History, IR, and tool execution

#### [x] Link history and IR entries by stable message IDs

Tool calls, tool outputs, assistant messages, and rejection prompts need type-safe links.

- Outcome: TypeScript IR gives user and assistant messages stable `messageId` values and links tool calls, tool results, skipped tools, errors, and rejections to their source messages.
- Behavior: trajectory assistant outputs link to emitted tool calls; `request-tool` mode reuses linked calls; tool rejections record `rejectedByUserMessageId` when the rejecting user prompt is submitted.
- Verify:

```sh
./node_modules/.bin/biome check --no-errors-on-unmatched packages/octofriend-tui/src/app/state/agent-runner.ts packages/octofriend-tui/src/app/state/history-actions.ts packages/octofriend-tui/src/app/state/types.ts packages/octofriend-tui/src/app/state/store.ts packages/octofriend-tui/src/internal/llm-ir/main.ts packages/octofriend-tui/src/internal/octo-agent-ir/main.ts packages/octofriend-tui/src/internal/tool-orchestration/main.ts packages/octofriend-tui/src/__tests__/app/state/main.test.ts packages/octofriend-tui/src/__tests__/internal/octo-agent-ir/octo-agent-ir.test.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/app/state/main.test.ts packages/octofriend-tui/src/__tests__/internal/agent-trajectory-runtime/agent-trajectory-runtime.test.ts packages/octofriend-tui/src/__tests__/internal/octo-agent-ir/octo-agent-ir.test.ts packages/octofriend-tui/src/__tests__/internal/conversation-history/conversation-history.test.ts packages/octofriend-tui/src/__tests__/app/tool_requests.test.tsx packages/octofriend-tui/src/__tests__/internal/tool-orchestration/tool-orchestration.test.ts packages/octofriend-tui/src/__tests__/internal/tool-orchestration/tool-orchestration-mcp.test.ts packages/octofriend-tui/src/__tests__/internal/tool-orchestration/tool-orchestration-lsp.test.ts
```

#### [x] Move edit/rewrite file reads from parse time to preflight/runtime

Parallel tool calls can make parse-time `originalFileContents` stale.

- Outcome: edit/rewrite argument parsing no longer reads target files or preserves stale model-provided `originalFileContents`.
- Implementation: the TUI runs `preflightToolCall()` for edit/rewrite requests, reads the active transport's current file contents before permission rendering and again immediately before `toolRun`, then passes preflighted parsed arguments and tool call metadata into agentd.
- Verify:

```sh
cargo test -p octofriend-tools --test runtime -- --nocapture
cargo test -p octofriend-agent --test agentd tool -- --nocapture
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/internal/tool-orchestration/tool-orchestration.test.ts packages/octofriend-tui/src/__tests__/app/tool_requests.test.tsx --timeout 30000
node_modules/.bin/tsc --noEmit -p packages/octofriend-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable
```

#### [x] Return structured tool errors for missing files

Loading a non-existent file should not crash Octo.

- Outcome: missing file loads become structured tool errors instead of panics.
- Behavior: `read` maps missing files to `No such file ...`; runtime validation reports `... couldn't be read`; edit/rewrite argument parsing omits stale `originalFileContents` when the target file is absent.
- Verify:

```sh
cargo test -p octofriend-tools --test runtime
cargo test -p octofriend-agent --test agentd trajectory_finish_request_returns_agentd_validation_retry
```

### Error handling and notifications

#### [x] Replace expected `throw` paths with Result types

- Outcome: TypeScript product, training, script, and canary failure paths now use existing `Result` unions where callers can branch on recoverable errors.
- Boundary behavior: public contracts that already return `Promise<T>` preserve async rejection semantics through Result-backed validation helpers and explicit rejected promises.
- Rust bridge behavior: the agentd Rust bridge validates daemon responses through `Result` before unwrapping. CLI/TUI configuration and transport paths no longer use exception statements for expected invalid-response or request-failure cases.
- Verify:

```sh
rg -n "\bthrow\b" --glob '!target/**' --glob '!node_modules/**' --glob '!benchmark/polyglot/.polyglot/**' --glob '!TODO.md' .
./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-cli/src/__tests__/bridge/rust/agent.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/input-history.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/update-notifications.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/conversation-history.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/tool-run.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/tool-permission.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/tool-validate.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/skill-discovery.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/agent-provider.test.ts packages/octofriend-cli/src/__tests__/bridge/rust/model-catalog.test.ts packages/octofriend-cli/src/__tests__/input-history.test.ts packages/octofriend-cli/src/__tests__/update-notifications.test.ts packages/octofriend-cli/tests/cli.test.ts packages/octofriend-tui/src/__tests__/internal/transport/transport.test.ts packages/octofriend-tui/src/__tests__/internal/configuration/notify.test.ts packages/octofriend-tui/src/__tests__/internal/configuration/configuration.test.ts
```

#### [x] Show dedicated auth, payment, and rate-limit errors

- Outcome: provider compiler maps HTTP 401/403 to `auth-error`, HTTP 402 to `payment-error`, and HTTP 429 to `rate-limit-error`.
- Behavior: trajectory handling preserves those finish reasons; the TUI routes `auth-error` and `payment-error` to dedicated retry screens instead of the generic request-error screen.
- Provider coverage: Synthetic, OpenAI-compatible chat-completions hosts, and Anthropic.
- Verify:

```sh
cargo test -p octofriend-agent --test agentd provider_compiler_complete_returns_structured_auth_errors -- --nocapture
cargo test -p octofriend-agent --test agentd provider_compiler_complete_maps_auth_errors_for_anthropic_providers -- --nocapture
cargo test -p octofriend-agent --test agentd provider_compiler_complete_maps_payment_required_for_standard_and_anthropic_providers -- --nocapture
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/app/error_screens.test.tsx
```

Covered cases:

- Synthetic payment errors: HTTP 402 on the standard OpenAI-compatible provider path.
- Anthropic payment errors: HTTP 402 on the Anthropic provider path.
- OpenAI payment errors: HTTP 402 on the standard OpenAI-compatible provider path.
- Synthetic auth failures: HTTP 401/403 on the standard OpenAI-compatible provider path.
- Anthropic auth failures: HTTP 401/403 on the Anthropic provider path.
- OpenAI auth failures: HTTP 401/403 on the standard OpenAI-compatible provider path.

#### [x] Use desktop notifications when waiting for user input

Ready-for-input notifications should use a configurable debounce and the upstream `toasted-notifier` package when no custom command is configured.

- Outcome: ready-for-input notifications keep `notifyTimeoutMs` debounce and use `toasted-notifier` as the built-in desktop notification backend.
- Behavior: custom shell `notifyCommand` values still run through agentd. The notifications menu is available without a custom command.
- Verify:

```sh
cargo test -p octofriend-config --test schema validates_notifications_without_custom_notify_command -- --nocapture
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/internal/configuration/notify.test.ts packages/octofriend-tui/src/__tests__/app/state/main.test.ts
PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p packages/octofriend-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable
```

### Transports and benchmarks

#### [x] Add SSH transport

- Outcome: OpenSSH-backed `SshTransport` exists alongside local and Docker transports.
- Implementation: agentd exposes SSH through `octofriend.agentd/transportSsh`; runtime tool execution receives `{ type: "ssh", target }`; CLI and TUI transport contracts have TypeScript SSH wrappers; the CLI exposes `octofriend ssh <target>`.
- Verify:

```sh
cargo test -p octofriend-transport -- --nocapture
cargo test -p octofriend-agent --test agentd transport -- --nocapture
cargo test -p octofriend-agent --test agentd tool::run -- --nocapture
cargo check -p octofriend-agent
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/internal/transport/transport.test.ts packages/octofriend-tui/src/__tests__/internal/tool-orchestration/tool-orchestration.test.ts --timeout 30000
node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --types bun,node --jsx react-jsx packages/octofriend-cli/src/transport/ssh.ts packages/octofriend-tui/src/internal/transport/ssh.ts packages/octofriend-cli/src/transport/common.ts packages/octofriend-tui/src/internal/transport/common.ts
```

#### [x] Port Aider Polyglot benchmarks to Octo

Run Aider Polyglot benchmark cases through Octo inside a container.

- Outcome: added `benchmark/polyglot/docker.sh`, `benchmark/polyglot/Dockerfile`, and `benchmark/polyglot/octofriend-polyglot.ts`.
- Docker behavior: builds a Linux `octofriend-agentd`, clones `Aider-AI/polyglot-benchmark` into container-local `/tmp`, snapshots selected exercises in memory, deletes the source checkout before non-dry-run solving, and writes benchmark outputs under `/benchmarks`.
- Harness behavior: hides tests/examples/metadata/invalidators from the agent workdir; restores original tests only in a separate scoring directory after each attempt; copies back only solution files; runs upstream-style language test commands; records per-case and cumulative JSON results; continues after case errors; supports config-free dry-run selection; applies separate request/tool and test timeouts.
- Verify:

```sh
env -i PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" /Users/krystian/.bun/bin/bun benchmark/polyglot/octofriend-polyglot.ts --help
env -i PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" /Users/krystian/.bun/bin/bun benchmark/polyglot/octofriend-polyglot.ts --dry-run --exercises-dir "$POLYGLOT_BENCHMARK_CHECKOUT" --languages go --num-tests 2
node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --types bun,node --jsx react-jsx benchmark/polyglot/octofriend-polyglot.ts packages/octofriend-tui/src/types/toasted-notifier.d.ts
bash -n benchmark/polyglot/docker.sh
octofriend_BENCHMARK_DIR="$(mktemp -d)" benchmark/polyglot/docker.sh --dry-run --languages go --num-tests 1
```

Run a scored case with a configured model/API key:

```sh
benchmark/polyglot/docker.sh --model <model-nickname> --languages go --num-tests 1 --tries 1
```

### Rendering

#### [x] Stack diffs in small terminal windows

- Outcome: `DiffRenderer` reads terminal width via `useTerminalSize()`.
- Behavior: widths `<= 80` render Old then New stacked vertically; wider terminals keep side-by-side panes.
- Verify:

```sh
PATH="$HOME/.bun/bin:$PATH" bun test packages/octofriend-tui/src/__tests__/rendering/code.test.tsx
```
