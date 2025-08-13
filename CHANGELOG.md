# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

## [0.0.24] - 2025-08-07

### Added

- Octo now hides most error stacks by default, and shows a smaller, more
  concise error message instead. To see the full stacktrace, run Octo with
  `OCTO_VERBOSE=1`

- Everything is now interruptible: even when long Bash commands are running, or
  long fetch tool calls, you can hit ESC to cancel the tool call and drop back
  into writing messages to Octo.
