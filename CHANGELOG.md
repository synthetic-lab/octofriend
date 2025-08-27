# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Octo can now automatically detect rate limit errors for any standard
  OpenAI-compatible client, and shows a special error message in the UI for
  them.

### Changed

- Fixed the line count shown in the UI for file creation
- Swapped the recommended Synthetic-hosted DeepSeek model to DeepSeek V3.1

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
