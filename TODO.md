TODO:

- [x] Situational awareness: if it's a git repo, check the gitignore, and get a
      bunch of the directory heirarchy into context space automatically.
      - Solution: agentd now builds the system prompt directory context from the filesystem
        when callers do not pass explicit `directoryEntries`, using `ignore::WalkBuilder` with
        standard filters so `.gitignore` and repository ignore defaults are respected. The
        resulting bounded hierarchy is rendered into the system prompt alongside the working
        directory.
      - Proof: run `cargo test -p octofwen-agent --test agentd system_prompt_discovers_gitignore_aware_directory_hierarchy -- --nocapture` and
        `cargo test -p octofwen-llm --test prompts system_prompt_renders_identity_workspace_listing_and_instruction_context -- --nocapture`.
- [x] Gemini API support: their "openai-compatible" API isn't complete enough
      to work with Octo
      - Solution: added a native `gemini` provider path with Google Gemini catalog metadata,
        `streamGenerateContent?alt=sse` requests using `x-goog-api-key`, Gemini contents/tool
        lowering, `parametersJsonSchema` tool declarations, Gemini stream/tool/usage parsing,
        Gemini 3 `thoughtSignature` round-tripping, and native Gemini model connection checks.
      - Proof: run `cargo test -p octofwen-llm --test providers`,
        `cargo test -p octofwen-llm --test compiler assistant_output`,
        `cargo test -p octofwen-agent --test agentd model_connection`,
        `cargo test -p octofwen-agent --test agentd provider`, and
        `OCTOFWEN_AGENTD=target/debug/octofwen-agentd bun test packages/octofwen-cli/src/__tests__/bridge/rust/model-catalog.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/agent-provider.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/agent.test.ts packages/octofwen-tui/src/__tests__/internal/model-provider-catalog/model-provider-catalog.test.ts packages/octofwen-tui/src/__tests__/menu/model_setup.test.ts`.
- [x] Refactor History/IR for type safety: link back between i.e. tool calls,
      tool outputs, and original assistant messages. Make rejections linked to the
      actual user message rejecting the call
      - Solution: TypeScript IR now gives user and assistant messages stable `messageId`
        values, requires tool calls to carry `assistantMessageId`, links trajectory assistant
        outputs to their emitted tool calls, reuses those linked calls for `request-tool`
        mode, links tool outputs/errors/skips back to the originating assistant message, and
        records `rejectedByUserMessageId` on tool rejections when the rejecting user prompt is
        submitted.
      - Proof: run `./node_modules/.bin/biome check --no-errors-on-unmatched packages/octofwen-tui/src/app/state/agent-runner.ts packages/octofwen-tui/src/app/state/history-actions.ts packages/octofwen-tui/src/app/state/types.ts packages/octofwen-tui/src/app/state/store.ts packages/octofwen-tui/src/internal/llm-ir/main.ts packages/octofwen-tui/src/internal/octo-agent-ir/main.ts packages/octofwen-tui/src/internal/tool-orchestration/main.ts packages/octofwen-tui/src/__tests__/app/state/main.test.ts packages/octofwen-tui/src/__tests__/internal/octo-agent-ir/octo-agent-ir.test.ts`,
        `./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false`, and
        `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/app/state/main.test.ts packages/octofwen-tui/src/__tests__/internal/agent-trajectory-runtime/agent-trajectory-runtime.test.ts packages/octofwen-tui/src/__tests__/internal/octo-agent-ir/octo-agent-ir.test.ts packages/octofwen-tui/src/__tests__/internal/conversation-history/conversation-history.test.ts packages/octofwen-tui/src/__tests__/app/tool_requests.test.tsx packages/octofwen-tui/src/__tests__/internal/tool-orchestration/tool-orchestration.test.ts packages/octofwen-tui/src/__tests__/internal/tool-orchestration/tool-orchestration-mcp.test.ts packages/octofwen-tui/src/__tests__/internal/tool-orchestration/tool-orchestration-lsp.test.ts`.
- [x] Remove all instances of `throw` and replace with Result types.
      - Solution: TypeScript product, training, script, and canary failure paths now return
        existing `Result` unions where callers can branch on recoverable errors, or preserve
        async rejection semantics through Result-backed validation helpers and explicit
        rejected promises where the public contract is already `Promise<T>`. The agentd Rust
        bridge validates daemon responses through `Result` before unwrapping, and CLI/TUI
        configuration and transport paths no longer use exception statements for expected
        invalid-response or request-failure cases.
      - Proof: run `rg -n "\bthrow\b" --glob '!target/**' --glob '!node_modules/**' --glob '!benchmark/polyglot/.polyglot/**' --glob '!TODO.md' .`,
        `./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false`, and
        `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-cli/src/__tests__/bridge/rust/agent.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/input-history.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/update-notifications.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/conversation-history.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/tool-run.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/tool-permission.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/tool-validate.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/skill-discovery.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/agent-provider.test.ts packages/octofwen-cli/src/__tests__/bridge/rust/model-catalog.test.ts packages/octofwen-cli/src/__tests__/input-history.test.ts packages/octofwen-cli/src/__tests__/update-notifications.test.ts packages/octofwen-cli/tests/cli.test.ts packages/octofwen-tui/src/__tests__/internal/transport/transport.test.ts packages/octofwen-tui/src/__tests__/internal/configuration/notify.test.ts packages/octofwen-tui/src/__tests__/internal/configuration/configuration.test.ts`.
- [x] Refactor menu system to use the new Router/Back stuff built for the add
      model flow.
      - Solution: the app menu top-level navigation now uses the shared typed
        `router`/`Back` primitives from the add-model flow. The previous
        app-menu-only Zustand `menuMode` store was removed, menu screens receive
        route callbacks through props, and model-switching keeps its scoped API-key
        substep cancellation instead of a broad Back wrapper.
      - Proof: run `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/menu/app_menu.test.tsx`,
        `PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p packages/octofwen-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable`, and
        `grep -R "useMenuState\|setMenuMode\|menuMode\|MenuMode\|MenuState" -n packages/octofwen-tui/src/menu/app_menu packages/octofwen-tui/src/__tests__/menu || true`.
- [x] Refactor first-time setup to use the new Router/Back stuff built for the
      add model flow.
      - Solution: the first-time setup flow now uses the shared `router`/`Back`
        primitives for the outer welcome/autofix/add-model/name/done routes, and
        the nested autofix setup flow now uses its own typed router for choose,
        Synthetic auth, diff-apply custom, and fix-json custom routes. The old
        `SetupStep`/`AutofixStates` step unions and step setters were removed;
        route props carry autofix config and connection error data between
        screens.
      - Proof: run `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/app/first_time_setup/main.test.tsx`,
        `PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p packages/octofwen-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable`, and
        `grep -R "SetupStep\|AutofixStates\|setAutofixStep\|setStep" -n packages/octofwen-tui/src/app/first_time_setup packages/octofwen-tui/src/__tests__/app/first_time_setup || true`.
- [x] Allow Anthropic models to configure the thinking budget by tokens, rather
      than low/medium/high corresponding to specific budgets (2048/4096/8192)
      - Solution: Anthropic provider planning accepts `thinkingBudgetTokens`, validates the
        explicit token budget against `max_tokens`, and prefers it over the preset
        `minimal`/`low`/`medium`/`high`/`xhigh` mappings for fixed-budget Anthropic models.
        Adaptive Anthropic model families use provider-specific `thinking`/`output_config`
        fields instead of forcing token budgets.
      - Proof: run `cargo test -p octofwen-agent --test agentd anthropic -- --nocapture` and
        `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-cli/src/__tests__/provider-run.test.ts packages/octofwen-tui/src/__tests__/internal/agent-trajectory-runtime/agent-trajectory-runtime.test.ts`.
- [x] Handle missing auth when switching models
      - Solution: model switching now resolves the selected model's auth through agentd before
        switching. Models with configured `apiEnvVar`/`auth` report the missing/invalid auth
        message instead of switching, while models without configured auth still fall back to
        the key-file setup prompt.
      - Proof: run `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/menu/app_menu.test.tsx` and
        `cargo test -p octofwen-agent --test agentd config_select_model_reports_missing_configured_env_auth -- --nocapture`.
- [x] Make the CLI prompt subcommand work with the anthropic and responses APIs
      - Solution: the prompt command resolves the selected model and delegates completion to
        `runCliProviderCompletion`, which forwards the model `type`, reasoning settings,
        modalities, system prompt, API key, and prompt IR to agentd's provider compiler. The
        agentd provider compiler supports `anthropic` and `openai-responses` plans in addition
        to the standard OpenAI-compatible path.
      - Proof: run `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-cli/src/__tests__/provider-run.test.ts` and
        `cargo test -p octofwen-agent --test agentd provider_compiler_complete_passes_openai_responses_xhigh_reasoning -- --nocapture` and
        `cargo test -p octofwen-agent --test agentd anthropic -- --nocapture`.
- [x] Make the CLI prompt subcommand handle reasoning tokens by streaming them
      to stderr, whereas the content tokens go to stdout
      - Solution: `createTokenHandler()` writes `reasoning` token events to stderr, writes
        `content` and `tool` token events to stdout, and inserts a stderr separator before the
        first content token after reasoning.
      - Proof: run `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-cli/src/__tests__/prompt.test.ts packages/octofwen-cli/src/__tests__/provider-run.test.ts`.
- [x] Add clickable URLs for known inference hosts to get an API key — use
      wandb-style authorize URLs if they exist!
      - Solution: provider catalog metadata now includes `apiKeyUrl` for Synthetic, OpenAI,
        Anthropic, Gemini, and xAI/Grok. The model setup API-key prompt looks up the selected
        provider by `baseUrl` and renders the URL as an OSC 8 terminal hyperlink, while unknown
        custom providers omit the link.
      - Proof: run `cargo test -p octofwen-agent --test agentd model_provider_catalog_request_returns_agentd_provider_catalog -- --nocapture`,
        `cargo build -p octofwen-agent --bin octofwen-agentd`,
        `OCTOFWEN_AGENTD=target/debug/octofwen-agentd PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/menu/model_setup.test.ts packages/octofwen-tui/src/__tests__/internal/model-provider-catalog/model-provider-catalog.test.ts`, and
        `OCTOFWEN_AGENTD=target/debug/octofwen-agentd PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-cli/src/__tests__/bridge/rust/model-catalog.test.ts`.
- [x] Generate desktop notifs with configurable debounce when waiting for user
      input via https://github.com/Aetherinox/node-toasted-notifier
      - Solution: ready-for-input notifications keep the configurable `notifyTimeoutMs` debounce
        and now use the upstream package's published `toasted-notifier` module as the built-in
        desktop notification backend when no custom `notifyCommand` is configured. Custom shell
        `notifyCommand` values still run through agentd, and the notifications menu is available
        without requiring a custom command.
      - Proof: run `cargo test -p octofwen-config --test schema validates_notifications_without_custom_notify_command -- --nocapture`,
        `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/internal/configuration/notify.test.ts packages/octofwen-tui/src/__tests__/app/state/main.test.ts`, and
        `PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p packages/octofwen-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable`.
- [x] Add special rendering for certain classes of errors, e.g. auth failures
      or payment-related failures
      - Solution: provider compiler maps HTTP 401/403 to `auth-error`, HTTP 402 to
        `payment-error`, and HTTP 429 to `rate-limit-error`; trajectory handling preserves
        those finish reasons; the TUI routes `auth-error` and `payment-error` into dedicated
        retry screens instead of the generic request-error screen. The standard
        OpenAI-compatible provider path covers Synthetic and OpenAI-compatible hosts, while
        Anthropic has its own request path with the same classification.
      - Proof: run `cargo test -p octofwen-agent --test agentd provider_compiler_complete_returns_structured_auth_errors -- --nocapture`,
        `cargo test -p octofwen-agent --test agentd provider_compiler_complete_maps_auth_errors_for_anthropic_providers -- --nocapture`,
        `cargo test -p octofwen-agent --test agentd provider_compiler_complete_maps_payment_required_for_standard_and_anthropic_providers -- --nocapture`, and
        `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/app/error_screens.test.tsx`.
  - [x] Synthetic payment errors
        - Solution: HTTP 402 on the standard OpenAI-compatible provider path is classified as
          `payment-error`; Synthetic uses that provider path.
        - Proof: run `cargo test -p octofwen-agent --test agentd provider_compiler_complete_maps_payment_required_for_standard_and_anthropic_providers -- --nocapture`.
  - [x] Anthropic payment errors
        - Solution: HTTP 402 on the Anthropic provider path is classified as `payment-error`.
        - Proof: run `cargo test -p octofwen-agent --test agentd provider_compiler_complete_maps_payment_required_for_standard_and_anthropic_providers -- --nocapture`.
  - [x] OpenAI payment errors
        - Solution: HTTP 402 on the standard OpenAI-compatible provider path is classified as
          `payment-error`; OpenAI-compatible chat-completions hosts use that provider path.
        - Proof: run `cargo test -p octofwen-agent --test agentd provider_compiler_complete_maps_payment_required_for_standard_and_anthropic_providers -- --nocapture`.
  - [x] Synthetic auth failures
        - Solution: HTTP 401/403 on the standard OpenAI-compatible provider path is classified
          as `auth-error`; Synthetic uses that provider path.
        - Proof: run `cargo test -p octofwen-agent --test agentd provider_compiler_complete_returns_structured_auth_errors -- --nocapture`.
  - [x] Anthropic auth failures
        - Solution: HTTP 401/403 on the Anthropic provider path is classified as `auth-error`.
        - Proof: run `cargo test -p octofwen-agent --test agentd provider_compiler_complete_maps_auth_errors_for_anthropic_providers -- --nocapture`.
  - [x] OpenAI auth failures
        - Solution: HTTP 401/403 on the standard OpenAI-compatible provider path is classified
          as `auth-error`; OpenAI-compatible chat-completions hosts use that provider path.
        - Proof: run `cargo test -p octofwen-agent --test agentd provider_compiler_complete_returns_structured_auth_errors -- --nocapture`.
- [x] Run the test-connection code for autofix models and all supported auth
      providers, and show billing- or auth-related errors immediately
      - Solution: Synthetic autofix setup now resolves the active auth source, runs
        model-connection tests before accepting autofix models, tests both default autofix
        models (`diff-apply` and `fix-json`) before completing setup, supports stored keys,
        configured env-var auth, custom env auth, and custom command auth, and returns
        connection error text immediately so billing/auth failures are shown in the setup UI.
      - Proof: run `cargo build -p octofwen-agent --bin octofwen-agentd` and
        `OCTOFWEN_AGENTD="$(pwd)/target/debug/octofwen-agentd" PATH="$HOME/.bun/bin:$PATH" bun test --timeout 30000 packages/octofwen-tui/src/__tests__/menu/model_setup.test.ts`.
- [x] Port Aider Polyglot benchmarks to Octo, run inside a container
      - Solution: added `benchmark/polyglot/docker.sh`, `benchmark/polyglot/Dockerfile`,
        and `benchmark/polyglot/octofwen-polyglot.ts`. The Docker wrapper builds a Linux
        `octofwen-agentd` inside the container, clones `Aider-AI/polyglot-benchmark` into
        container-local `/tmp`, snapshots selected exercises in memory, deletes the source
        checkout before non-dry-run solving, and runs the Bun harness with benchmark outputs
        under `/benchmarks`. The harness hides tests/examples/metadata/invalidators from the
        agent workdir, restores original tests only in a separate scoring directory after each
        attempt, copies back only solution files, runs upstream-style language test commands,
        records per-case and cumulative JSON results, continues after case errors, supports
        config-free dry-run selection, and applies separate request/tool and test timeouts.
      - Proof: run `env -i PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" /Users/krystian/.bun/bin/bun benchmark/polyglot/octofwen-polyglot.ts --help`,
        `env -i PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" /Users/krystian/.bun/bin/bun benchmark/polyglot/octofwen-polyglot.ts --dry-run --exercises-dir "$POLYGLOT_BENCHMARK_CHECKOUT" --languages go --num-tests 2`,
        `node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --types bun,node --jsx react-jsx benchmark/polyglot/octofwen-polyglot.ts packages/octofwen-tui/src/types/toasted-notifier.d.ts`,
        `bash -n benchmark/polyglot/docker.sh`, and
        `OCTOFWEN_BENCHMARK_DIR="$(mktemp -d)" benchmark/polyglot/docker.sh --dry-run --languages go --num-tests 1`.
        A real scored run requires a configured model/API key and can be started with
        `benchmark/polyglot/docker.sh --model <model-nickname> --languages go --num-tests 1 --tries 1`.
- [x] Add SSH transport
      - Solution: added an OpenSSH-backed `SshTransport` alongside local and Docker transports,
        exposed it through agentd as `octofwen.agentd/transportSsh`, wired it into runtime tool
        execution with `{ type: "ssh", target }`, added TypeScript SSH transport wrappers for the
        CLI and TUI transport contracts, and added an `octofwen ssh <target>` CLI entry point.
      - Proof: run `cargo test -p octofwen-transport -- --nocapture`,
        `cargo test -p octofwen-agent --test agentd transport -- --nocapture`,
        `cargo test -p octofwen-agent --test agentd tool::run -- --nocapture`,
        `cargo check -p octofwen-agent`,
        `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/internal/transport/transport.test.ts packages/octofwen-tui/src/__tests__/internal/tool-orchestration/tool-orchestration.test.ts --timeout 30000`, and
        `node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --types bun,node --jsx react-jsx packages/octofwen-cli/src/transport/ssh.ts packages/octofwen-tui/src/internal/transport/ssh.ts packages/octofwen-cli/src/transport/common.ts packages/octofwen-tui/src/internal/transport/common.ts`.
- [x] When Octo returns input back to the user, run a special loop with a basic
      prompt that checks whether Octo forgot anything (i.e. did it run tests, run a
      compiler, etc).
      - Solution: `trajectoryArc` now runs a one-pass internal forgotten-check provider call
        before returning a final `needs-response` answer to the UI. The check prompt asks the
        model to verify whether tests, compiler/typecheck/lint, result inspection, or a precise
        blocker were missed. The internal prompt is sent only to the provider, is not returned
        as user-visible IR, preserves the original answer if the check provider call fails, and
        is skipped for retry-tool `needs-response` paths.
      - Proof: run `cargo test -p octofwen-agent --test agentd trajectory_arc_runs_forgotten_check_before_returning_input -- --nocapture`,
        `cargo test -p octofwen-agent --test agentd trajectory -- --nocapture`, and
        `cargo fmt --all --check`.
- [x] Fix crash when model tries to load a non-existent file
      - Solution: missing file loads now become structured tool errors instead of panics:
        `read` maps missing files to `No such file ...`, runtime validation reports
        `... couldn't be read`, and edit/rewrite argument parsing omits stale
        `originalFileContents` when the target file is absent.
      - Proof: run `cargo test -p octofwen-tools --test runtime` and `cargo test -p octofwen-agent --test agentd trajectory_finish_request_returns_agentd_validation_retry`.
- [x] If the terminal window is small, show diffs stacked on top of each other
      instead of side-by-side
      - Solution: `DiffRenderer` now reads terminal width via `useTerminalSize()` and uses a
        stacked Old-then-New layout at widths `<= 80`, while preserving side-by-side panes for
        wider terminals.
      - Proof: run `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/rendering/code.test.tsx`; the focused tests assert stacked panes at width 60 and side-by-side panes at width 120.
- [x] Getting originalFileContents at parse-time is actually incorrect. With
      parallel tool calls, there may be intermediate file writes that haven't
      applied yet. The original file contents should probably be read at runtime
      when the tool is doing a permissions check, and passed in as metadata to the
      edit/rewrite tools. Actually... I think you need something better, or
      else your trajectory code will get complex. You probably need an async
      `preflight` function that can return runtime data right before running a
      tool, and running the tool requires first running the preflight. Then the
      tool can define its own preflight data, store it, and use it. Callers get
      notified via events of preflight data IMO. This assumes a fairly large
      refactor where the entire agent/permissions loop is inside something else
      and the app code simply listens to events from that (although subagents
      require that refactor anyway).
      - Solution: edit/rewrite argument parsing no longer reads target files or preserves
        model-provided stale `originalFileContents`. The TUI now runs an async
        `preflightToolCall()` for edit/rewrite requests, reading the active transport's current
        file contents before permission rendering and again immediately before `toolRun`, then
        passes the preflighted parsed arguments and tool call into agentd.
      - Proof: run `cargo test -p octofwen-tools --test runtime -- --nocapture`,
        `cargo test -p octofwen-agent --test agentd tool -- --nocapture`,
        `PATH="$HOME/.bun/bin:$PATH" bun test packages/octofwen-tui/src/__tests__/internal/tool-orchestration/tool-orchestration.test.ts packages/octofwen-tui/src/__tests__/app/tool_requests.test.tsx --timeout 30000`, and
        `node_modules/.bin/tsc --noEmit -p packages/octofwen-tui/tsconfig.json --lib ES2023,DOM,DOM.Iterable`.
