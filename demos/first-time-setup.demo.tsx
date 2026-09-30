import React from "react";
import fs from "fs/promises";
import os from "os";
import path from "path";
import chalk from "chalk";
import { FirstTimeSetup } from "../source/first-time-setup.tsx";
import { processes } from "../source/process-manager.ts";
import { THEME_COLOR } from "../source/theme.ts";
import { runDemo } from "./run-demo.tsx";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "octo-demo-"));
const cleanup = () => fs.rm(directory, { recursive: true, force: true });
const unregisterCleanup = processes.manager().registerOctoExitCleanup(cleanup);

try {
  await runDemo(() => <FirstTimeSetup configPath={path.join(directory, "octofriend.json5")} />);
} finally {
  console.log(chalk.hex(THEME_COLOR)("\nCleaning up temporary files... Please don't force quit!"));
  unregisterCleanup();
  await cleanup();
}
