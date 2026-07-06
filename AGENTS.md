# AGENTS.md

This repository contains the source code for `octofwen`, the TypeScript and Rust rewrite of `octofriend`.

Build and validation commands are moving to Bun-first workspace commands during the rewrite. Prefer the commands documented in the active package manifests and run focused validation for changed product code.

Prefer `type Name = { ... }` to `interface Name { ... }` unless the shape is designed for class implementation or declaration merging.
