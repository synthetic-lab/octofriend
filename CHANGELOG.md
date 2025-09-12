# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
