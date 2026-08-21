#!/usr/bin/env bun

import { isStandaloneExecutable } from "../bun-env.ts";

if (isStandaloneExecutable()) {
  // Paintcannon's napi-rs loader needs a path to the native binding. build.ts
  // copies the target's binding to dist/build-assets/paintcannon.node; this
  // import embeds the file into the binary and resolves to its $bunfs path.
  if (process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] == null) {
    const binding = await import("../../dist/build-assets/paintcannon.node", {
      with: { type: "file" },
    });
    process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] = binding.default;
  }

  // paintcannon-react locates its own package.json at startup (for the React
  // renderer version); embedding it puts it at /$bunfs/root/package.json,
  // where its walk from the bundle's dir finds it immediately.
  await import("../../node_modules/paintcannon-react/package.json", { with: { type: "file" } });
}
// Dynamic import so everything above happens before paintcannon's napi loader runs.
await import("./cli.js");
