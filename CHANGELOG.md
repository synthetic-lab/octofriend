# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.49] - 2026-01-02

### Added

- Octo now uses autocompaction instead of rolling history windows for
  long-context tasks. This helps improve prompt cache hit rates, and helps keep
  Octo on task more reliably.

- Initial support for [Agent Skills](https://agentskills.io/). Agent skills
  are read by default from `~/.config/agents/skills`, but the path can be
  configured in `~/.config/octofriend/octofriend.json5`.

### Changed

- Improved Vim mode UX: Octo starts in Insert mode by default.

- Prettier, on-theme scroll UI

- File editing prompt improvements that help GLM-4.7 more accurately edit
  during long-context tasks.

## [0.0.48] - 2025-12-17

### Added

- Octo now supports a global AGENTS.md in `~/.config/AGENTS.md`, similar to
  other coding tools.

### Changed

- Octo no longer flickers when rendering long assistant outputs, thanks to a
  new ScrollView component that allows mouse-based scrolling for in-progress
  assistant responses.

- Fixed a bug where hitting ESC couldn't interrupt shell commands that spawned
  subprocesses.

## [0.0.47] - 2025-12-04

### Added

- Optional Vim mode emulation for text input: enable it through the menu.

### Changes

- Added easy onboarding for latest OpenAI and Anthropic models

- Updated getting started guide

## [0.0.46] - 2025-11-06

### Added

- Added a new feature to copy failed requests as cURL commands for easy
  debugging.

### Changes

- Minor modifications to tool call schemas for improved GLM-4.6 usage

## [0.0.45] - 2025-10-16

### Changed

- Fixed copy/pasting long amounts of text and improved typing performance

- Simplify tool call formats for more-accurate editing for LLMs like the GLM
  4.x series that internally don't produce JSON during tool streaming

### Added

- Show byte counts during LLM responses

## [0.0.44] - 2025-09-30

### Changed

- Added Claude 4.5 Sonnet as a featured model for Anthropic

- Added GLM-4.6 as a featured model for Synthetic

- Allowed configuring environment variables for MCP servers

- Auto-shut-down MCP servers on exit

## [0.0.43] - 2025-09-26

### Changed

- Fixed syntax highlighting bug that sometimes rendered spurious `</span>` tags

## [0.0.42] - 2025-09-26

### Added

- Add time-to-first-token and inter-token-latency calculation to `octo bench
  tps`.

## [0.0.41] - 2025-09-24

### Changed

- Correct output token/sec benchmarking

## [0.0.40] - 2025-09-19

### Changed

- Performance improvement for typing in the input box

## [0.0.39] - 2025-09-18

### Changed

- Crash fix for when Octo proposes impossible edits

## [0.0.38] - 2025-09-18

### Changed

- All edits and file creations are shown with syntax highlighting and line
  numbers.

- Running local bash commands works better on Nix and other systems that don't
  have `bash` in the typical `/bin/bash` location

- Various bugfixes

## [0.0.37] - 2025-09-11

### Added

- Markdown is now rendered beautifully

- Code inside Markdown uses syntax highlighting

- Pressing up or down in the input box cycles through prompt history

- Emacs-style keybindings like ctrl-e, ctrl-a, etc work

### Changed

- Improved rendering and UX for request errors: instead of retrying forever,
  Octo will prompt you as to whether or not you want to retry, and can
  optionally show you the error from the backend to help you debug what's gone
  wrong.

- Fix for backends that don't support strict tool calling, and yet error out
  when input doesn't match the provided JSON schema

## [0.0.36] - 2025-09-04

### Added

- Feature Kimi K2 0905 in onboarding!

- Allow setting a custom prompt for tps benchmarking

## [0.0.35] - 2025-09-02

- Fixes to path detection for OCTO.md, AGENTS.md, etc

## [0.0.34] - 2025-09-01

- Ensure config dir exists before writing to API key file

## [0.0.33] - 2025-08-28

### Changed

- Improved accuracy of Anthropic token-per-second by updating initial prompt to
  avoid tool calls.

## [0.0.32] - 2025-08-28

### Added

- Adds a new `octo bench tps` subcommand, that benchmarks the tokens-per-second
  you're getting from your API provider. Uses your default model if none is
  specified, or you can run `octo bench tps --model "<model-nickname>"` to
  benchmark any model you've set up inside Octo.

## [0.0.31] - 2025-08-27

### Added

- Octo can now automatically detect rate limit errors for any standard
  OpenAI-compatible client, and shows a special error message in the UI for
  them.

### Changed

- Swapped the recommended Synthetic-hosted DeepSeek model to DeepSeek V3.1
- Fixed the line count shown in the UI for file creation
- Fix crash when models hallucinate impossible file names

## [0.0.30] - 2025-08-23

- Fixed rendering error in model nickname flow

## [0.0.29] - 2025-08-21

### Changed

- Fixed rendering error when adding custom models during setup.

## [0.0.28] - 2025-08-20

### Added

- You can now run Octo inside any Docker container: all filesystem commands and
  shell commands will run inside the container, instead of on your host system.
  You don't need to install anything or configure the container in any way:
  Octo is Docker-aware and works with any Docker container. To connect Octo to
  a container you already have running on your system, run the following:
  `octo docker connect my-container-name`.

- Octo can also launch Docker images for you and auto-connect to them with:
  `octo docker run -- <docker run args>`; for example: `octo docker run
  -d -i -t --rm node:24-alpine /bin/sh`. Once you quit Octo, it'll automatically
  shut down the container it spawned. All args to `docker run` are supported.

### Changed

- Octo no longer shows a list of updates on first install: the update list only
  appears when you actually *update* Octo.

- Fix a crash

## [0.0.27] - 2025-08-19

### Changed

- Urgent bugfix for crash-on-boot when data dir is uninitialized

## [0.0.26] - 2025-08-19

### Added

- Octo now auto-detects billing-related errors for many OpenAI-compatible APIs,
  including Synthetic, and displays a helpful message when you encounter them.

- After updating, Octo now displays a short list of updates in-app on first
  launch. (Afterwards, the updates aren't shown anymore, although you can run
  `octo changelog` to view the full changelog.)

### Changed

- Fixed crash that occurred when adding custom models

- Correctly show lines read in the UI when Octo reads files

- General UI improvements

## [0.0.25] - 2025-08-16

### Added

- Octo now supports adding explicit API keys, rather than requiring environment
  variables for API key management. If the default env var isn't detected —
  like, say, `SYNTHETIC_API_KEY` for Synthetic models — you're now able to set
  an API key within Octo. Keys are stored in a special
  `~/.config/octofriend/keys.json5` file, so that you can keep your main
  `~/.config/octofriend.json5` config in dotfiles repositories without leaking
  secret API keys.

- Octo will automatically prompt you to re-auth on boot if your config lists a
  default model or autofix models for which you no longer have auth info for
  (either you no longer export the API key env var in your shell, or you no
  longer have a `keys.json5` file — for example, if you're setting up a new
  machine and have synced your `octofriend.json5` via a dotfiles repo).

- Octo can now be accessed either via `octofriend` or just `octo` for short.

### Changed

- Config files are now sanitized before being written, to prevent duplicate env
  var definitions for the same built-in providers.

## [0.0.24] - 2025-08-07

### Added

- Octo now hides most error stacks by default, and shows a smaller, more
  concise error message instead. To see the full stacktrace, run Octo with
  `OCTO_VERBOSE=1`

- Everything is now interruptible: even when long Bash commands are running, or
  long fetch tool calls, you can hit ESC to cancel the tool call and drop back
  into writing messages to Octo.
