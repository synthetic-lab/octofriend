#!/usr/bin/env bun

import { isStandaloneExecutable } from "../bun-env.ts";

// Injected at build time by build.ts (`bun build --define`), pointing at the
// paintcannon native binding embedded via --asset. Only referenced inside the
// standalone-executable branch below, so it never evaluates at dev time.
declare const OCTO_EMBEDDED_PAINTCANNON_BINDING: string;

process.env["NODE_ENV"] = "production";

// Point paintcannon's napi-rs loader at the binding embedded via --asset.
if (isStandaloneExecutable() && process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] == null) {
  process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] = OCTO_EMBEDDED_PAINTCANNON_BINDING;
}
// Dynamic import so the env var above is set before paintcannon's napi loader runs.
await import("./cli.js");
