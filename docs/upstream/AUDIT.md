# Upstream issue and pull-request audit

Audited against the `rewrite` worktree on 2026-07-12. Status meanings:

- **Resolved**: current source directly implements the requested behavior or removes the reported failure mode.
- **Partial**: relevant support exists, but a named requirement remains.
- **Missing**: current source directly contradicts or lacks the requested behavior.
- **External**: not provable or fixable solely from product source.
- **Replaced**: the rewrite removed the upstream implementation/failure mode; focused regression coverage may still be warranted.

## Issues

| Issue | Status | Current evidence and required follow-up |
|---|---|---|
| [#158](https://github.com/synthetic-lab/octofriend/issues/158) Web-search context size | **Resolved in worktree** | Web-search responses are rejected before parsing/model injection when they exceed 64 KiB or the smaller configured model-context budget; focused success and oversize tests pass. |
| [#152](https://github.com/synthetic-lab/octofriend/issues/152) User-controlled compaction | **Resolved in worktree** | `/compact` forces a compact-only trajectory; `autoThresholdPercent` configures the 1–100% trigger (90% default), and `compactOldestPercent` summarizes only the oldest configured fraction while retaining recent messages. The shell bottom bar continuously reports current context-token usage. |
| [#149](https://github.com/synthetic-lab/octofriend/issues/149) TTFT/TPS verbose mode | **Resolved in worktree** | The provider SSE reader timestamps complete frames, identifies the first actual token for TTFT, and records total duration/output usage. Off-by-default `showProviderMetrics` (or interactive `/metrics`) prints TTFT and post-first-token tok/s for each provider request. |
| [#148](https://github.com/synthetic-lab/octofriend/issues/148) Pre-filled interactive prompt | **Resolved in worktree** | `octo --prefill <prompt>` hydrates a new interactive editor without submitting or adding history; CLI/TUI regression tests pass. |
| [#144](https://github.com/synthetic-lab/octofriend/issues/144) Directory-scoped auto-allow | **Resolved in worktree** | Permission requests now carry transport CWD; read/list/glob/grep/LSP auto-allow only inside it, and whitelist keys are directory-scoped. Traversal and prefix-sibling tests added. |
| [#139](https://github.com/synthetic-lab/octofriend/issues/139) Vim duplication | **Replaced** | The old monolithic vim-mode implementation is gone; editor movement is split across `packages/tui/src/input/editor/`. |
| [#137](https://github.com/synthetic-lab/octofriend/issues/137) Modify API key | **Resolved** | API-key menu/routes and key-writing bridge exist under `packages/tui/src/menu/models/` and `packages/tui/src/runtime/config/keys.ts`. |
| [#136](https://github.com/synthetic-lab/octofriend/issues/136) Prettier hook reflow | **Replaced** | The rewrite is Bun/Biome-based and does not contain the reported Prettier pre-commit path. |
| [#133](https://github.com/synthetic-lab/octofriend/issues/133) Vim input visual overflow | **Resolved / replaced** | The old component was replaced by the modular editor/rendering implementation; controlled-input tests prove rapid edits apply to the latest value, newline insertion is stable, and narrow terminal wrapping is bounded. |
| [#132](https://github.com/synthetic-lab/octofriend/issues/132) Show shell output | **Resolved in worktree** | `showShellOutput: true` expands normalized text for linked shell tool outputs while retaining the line-count summary; non-shell tool output remains collapsed. Schema and renderer regression tests pass. |
| [#129](https://github.com/synthetic-lab/octofriend/issues/129) Ambiguous context `k` | **Resolved in worktree** | Context setup now requires a full positive integer such as `32000`; unit suffixes are rejected and defaults use the same representation. |
| [#123](https://github.com/synthetic-lab/octofriend/issues/123) ACP | **Resolved in worktree** | The standalone `octofriend-acp` SDK adapter runs standard prompts over duplex NDJSON, streams assistant and thought updates, requests tool permissions, cancels in-flight trajectories without closing the connection, and exposes per-session model selection. Focused protocol/runtime tests cover every named path. |
| [#104](https://github.com/synthetic-lab/octofriend/issues/104) Release tags | **External / missing upstream** | Upstream currently returns no Git tags. Release tagging requires repository release operations, not product code. |
| [#93](https://github.com/synthetic-lab/octofriend/issues/93) Native Windows | **Resolved with CI evidence** | Fork run `28781209609` completed its `windows-latest` job successfully: packaged agentd, PowerShell canary, packed global `octofriend`/`octo` launch, typecheck, Bun tests, workspace build, and Rust tests. Source also uses `cmd.exe` and `CREATE_NO_WINDOW`; the current unpushed worktree awaits its next matrix run. |
| [#91](https://github.com/synthetic-lab/octofriend/issues/91) Document Windows support | **Resolved in worktree** | README now states native Linux/macOS/Windows support and gives Windows shell expectations. |
| [#74](https://github.com/synthetic-lab/octofriend/issues/74) Resume conversations | **Resolved in worktree** | TUI history persists locally; `octo --resume <id>` hydrates it and restores local/Docker/SSH launch options. Append-only parent revisions preserve concurrent sibling branches and load the newest revision. |
| [#73](https://github.com/synthetic-lab/octofriend/issues/73) WSL process windows | **Resolved in source; Windows build unverified locally** | Local shell tool processes now use Windows `CREATE_NO_WINDOW`; local transport tests pass on macOS, but the installed Rust toolchain lacks this repository toolchain's Windows standard library for a cross-check. |
| [#50](https://github.com/synthetic-lab/octofriend/issues/50) Focused diffs | **Resolved in worktree** | Rewrite diffs collapse distant unchanged regions to three context lines around each hunk, show omitted line ranges, preserve gutter numbering, and stack old/new panes on narrow terminals. Edit diffs retain their focused search/replace behavior. |
| [#49](https://github.com/synthetic-lab/octofriend/issues/49) Invalid fetch URL crash | **Resolved** | Rust fetch uses `reqwest` and converts request failures into tool errors instead of throwing an uncaught JavaScript exception. |
| [#48](https://github.com/synthetic-lab/octofriend/issues/48) New conversation command | **Resolved** | `/clear` clears conversation history without restarting Octo. |
| [#41](https://github.com/synthetic-lab/octofriend/issues/41) Homebrew | **Resolved in worktree; publication pending** | The repository hosts a generated `Formula/octofriend.rb` on its default branch after each release. The same workflow publishes Scoop metadata, an embedded Chocolatey package, standalone curl/wget and Windows PowerShell 5.1 installers, checksums, and attestations. |
| [#39](https://github.com/synthetic-lab/octofriend/issues/39) Invalid tool input shape | **Resolved** | Tool requests are parsed and JSON-schema validated in Rust before provider/tool execution. |
| [#29](https://github.com/synthetic-lab/octofriend/issues/29) Text/XML MCP MIME type | **Resolved in worktree** | Text resources now render non-`text/plain` MIME types beside the URI; `text/xml` behavior is covered by the MCP rendering test. |
| [#26](https://github.com/synthetic-lab/octofriend/issues/26) Claude Max/subagents | **Answered / not ported** | This issue asks whether the features exist rather than specifying an accepted implementation. The product explicitly supports Anthropic API keys, not Claude Max subscription credentials; built-in tools define no subagent, and dormant typed variants deliberately return an unsupported error. No unsafe credential reuse or recursive-agent behavior was invented. |
| [#8](https://github.com/synthetic-lab/octofriend/issues/8) Tool call parsing failure | **Resolved** | The rewrite includes provider stream normalization, strict argument handling, schema validation, malformed-request IR, and tests. |
| [#4](https://github.com/synthetic-lab/octofriend/issues/4) Session/directory approval | **Resolved in worktree** | Session whitelist keys now include the normalized project or target directory; outside-project reads prompt instead of auto-running. |
| [#2](https://github.com/synthetic-lab/octofriend/issues/2) Slash commands | **Resolved in worktree** | `/help`, `/clear`, `/compact`, `/init [instructions]`, `/model`, and `/quit` exist. `/init` runs a normal permission-controlled agent turn to inspect the repository and create or update durable `OCTO.md` guidance. |

## Pull requests excluding xsyetopz

| PR | Status | Porting decision |
|---|---|---|
| [#220](https://github.com/synthetic-lab/octofriend/pull/220) Session resume | **Ported in worktree** | Sessions persist, hydrate, rotate on `/clear`, flush on exit, and restore local/Docker/SSH launch options through top-level `--resume`. Each save appends a foreign-keyed parent revision; concurrent resumes retain sibling branches and each process advances its own parent, matching the upstream tree invariant. |
| [#178](https://github.com/synthetic-lab/octofriend/pull/178) MCP reconnect | **Replaced** | The production runtime in `runtime/mcp/run.rs` starts and tears down a fresh MCP child for every call, so no stale client survives to the next call. The cached registry is exported/tested compatibility code with no production callsite. |
| [#177](https://github.com/synthetic-lab/octofriend/pull/177) Permission directory | **Ported in worktree** | Implemented at the Rust policy boundary rather than transplanting React path logic; transport CWD is explicit and all filesystem read tools share the rule. |
| [#174](https://github.com/synthetic-lab/octofriend/pull/174) Config validation errors | **Ported in worktree** | Agentd now preserves field-level Rust validation details, and JSON5 parse failures include the config path plus parser detail while retaining the original cause. |
| [#170](https://github.com/synthetic-lab/octofriend/pull/170) AI SDK performance entries | **Replaced** | The AI SDK `streamText` implementation no longer exists; Rust HTTP streaming does not create those Node performance measures. |
| [#165](https://github.com/synthetic-lab/octofriend/pull/165) ACP adapter | **Ported in worktree** | Implemented as a standalone asynchronous ACP SDK adapter instead of extending agentd synchronous request handling. It provides standard prompts, duplex streaming updates, permission callbacks, cancellation, and per-session model selection; session loading is deliberately not advertised. |

## Validation for the permission port

- `cargo test -p octofriend-agent --test permissions`: 5 passed.
- `cargo test -p octofriend-agent --test agentd tool_permission_request_returns_permission_policy`: 1 passed.
- `bun test packages/tui/tests/render/tools.test.tsx packages/tui/tests/shell/tool-requests.test.tsx packages/cli/tests/bridge/agent/tool-permission.test.ts`: 18 passed.
- `bun run typecheck`: passed for shared, TUI, and CLI packages.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`: passed after refactoring the catalog, provider request planner, trajectory compaction path, token refresh helpers, and TypeScript-facing stream modules without lint suppressions.

## Additional focused validation

- `cargo test -p octofriend-tools --test mcp rendering`: 3 passed.
- `cargo test -p octofriend-tools --test runtime runs_runtime_web_search_tool_calls`: passed.
- `cargo test -p octofriend-tools --test runtime rejects_oversized_runtime_web_search_responses`: passed.
- `bun test packages/tui/tests/menu/context-tokens.test.tsx packages/tui/tests/menu/flows.test.tsx`: 4 passed.
- `cargo test -p octofriend-workspace --test local local_transport`: 5 passed.
- `cargo test -p octofriend-agent --test agentd config_migrate_request_returns_actionable_validation_error`: passed.
- `bun test packages/cli/tests/config/config-file.test.ts`: 2 passed.
- `cargo test -p octofriend-store --test repositories history`: 11 passed, including foreign-keyed sibling revisions and newest-revision loading.
- `cargo test -p octofriend-agent --test agentd conversation_session_requests_create_replace_and_load_snapshots`: passed.
- `bun test packages/cli/tests/bridge/agent/history.test.ts`: 4 passed.
- `bun test packages/cli/tests/session.test.ts packages/cli/tests/bridge/agent/history.test.ts packages/tui/tests/shell/shell.test.tsx packages/tui/tests/shell/state/main.test.ts`: 26 passed, including concurrent branch-parent simulation.
- `cargo test -p octofriend-agent --test agentd provider::`: 19 passed across all provider stream/error formats.
- `bun test` focused rendering, compaction, metrics, slash-command, and session suites: 71 + 26 passed in the recorded combined runs.
- Live `gh` refresh on 2026-07-12 reconfirmed 27 open issues and six open non-`xsyetopz` PRs with unchanged IDs.

## Broad validation and remaining caveats

- `bun test`: 835 passed, 0 failed across 122 files, including duplex ACP, ChatGPT OAuth account claims, cURL script recovery, installers, sessions, and distribution metadata.
- `cargo test --workspace`: passed across every crate, integration test, protocol conformance test, and doc test.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`: passed with no suppressions.
- `bun run typecheck`: passed for shared, TUI, and CLI packages.
- `biome check . --max-diagnostics=1000`: checked 411 files with no findings.
- `cargo fmt --all -- --check` and `git diff --check`: passed.
- `scripts/test-install.ps1`: passed under local PowerShell, including checksum verification and installation of all Windows executables.
- Managed Docker-compatible runtime launches add `--rm` without duplicating an explicit option; focused tests pass, and the README documents OrbStack plus `--pull=never` for storage-conservative use.
- GitHub CLI plumbing resolves the local `xsyetopz/octofwen` remote redirect to canonical repository `xsyetopz/octofriend-next`, whose default branch is `rewrite`; installer and package-manager URLs therefore target the owning repository rather than a stale fork.
- Upstream commits [#217](https://github.com/synthetic-lab/octofriend/pull/217) and [#221](https://github.com/synthetic-lab/octofriend/pull/221) were reconciled after porting their durable behavior: ChatGPT account identity is extracted from OAuth JWT claims and stored with mode `0600`, while failed provider requests can be written to a uniquely named mode-`0700` cURL script under the system temporary directory.
- Current `synthetic-lab/main` is an ancestor of local `rewrite`; `git merge-tree --write-tree rewrite upstream/main` succeeds without conflicts. Draft PR #222 will continue to report its old conflict until the local branch is pushed.
- No audited product port remains incomplete. Release-tag and hosted package-manager evidence still requires publication of the prepared release workflow.
