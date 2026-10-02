import React from "react";
import path from "path";
import os from "os";
import { mkdtemp, rm } from "fs/promises";
import { FirstTimeSetup } from "../source/first-time-setup.tsx";
import { runDemo } from "./run-demo.tsx";
import { loadSyntheticModels } from "../source/synthetic-models.ts";

await runDemo(async fixtures => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "octofriend-setup-demo-"));
  fixtures.defer(() => rm(directory, { recursive: true, force: true }));
  const syntheticModels = await loadSyntheticModels(AbortSignal.timeout(5000));
  return (
    <FirstTimeSetup
      configPath={path.join(directory, "octofriend.json5")}
      syntheticModels={syntheticModels}
    />
  );
});
