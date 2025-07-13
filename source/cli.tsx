#!/usr/bin/env node
import React from "react";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { render } from "ink";
import { Command } from "@commander-js/extra-typings";
import App from "./app.tsx";
import { readConfig, readMetadata, initConfig } from "./config.ts";
import { totalTokensUsed } from "./llm.ts";

const CONFIG_STANDARD_DIR = path.join(os.homedir(), ".config/octofriend/");

const cli = new Command()
.option("--config <path>")
.action(async (opts) => {
	const config = await loadConfig(opts.config);
	const metadata = await readMetadata();

	const { waitUntilExit } = render(<App config={config} metadata={metadata} />);
  await waitUntilExit();
  console.log(`\nApprox. tokens used: ${totalTokensUsed().toLocaleString()}`);
});

async function loadConfig(configPath?: string) {
  if(configPath) return await readConfig(configPath);

  const json5File = path.join(CONFIG_STANDARD_DIR, "octofriend.json5")
  try {
    await fs.stat(json5File);
    return await readConfig(json5File);
  } catch {
    try {
      const jsonFile = path.join(CONFIG_STANDARD_DIR, "octofriend.json")
      await fs.stat(jsonFile);
      return await readConfig(jsonFile);
    } catch {
      return await initConfig(json5File);
    }
  }
}

cli.parse();
