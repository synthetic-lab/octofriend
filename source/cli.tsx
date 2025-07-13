#!/usr/bin/env node
import React from "react";
import path from "path";
import os from "os";
import { render } from "ink";
import { Command } from "@commander-js/extra-typings";
import { fileExists } from "./fs-utils.ts";
import App from "./app.tsx";
import { readConfig, readMetadata, initConfig } from "./config.ts";
import { totalTokensUsed } from "./llm.ts";
import { getMcpClient, connectMcpServer } from "./tools/tool-defs/mcp.ts";

const CONFIG_STANDARD_DIR = path.join(os.homedir(), ".config/octofriend/");

const cli = new Command()
.description("If run with no subcommands, runs Octo interactively.")
.option("--config <path>")
.action(async (opts) => {
	const metadata = await readMetadata();
	const config = await loadConfig(opts.config);
  if(!process.env[config.apiEnvVar]) {
    console.error(`
Octo is set to use the ${config.apiEnvVar} env var to authenticate with the API, but that env var
isn't set in your current shell.

Hint: do you need to re-source your .bash_profile or .zshrc?
`.trim());
    process.exit(1);
  }

  // Connect to all MCP servers on boot
  if(config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    for(const server of Object.keys(config.mcpServers)) {
      console.log("Connecting to", server, "MCP server...");
      // Run the basic connection setup with logging enabled, so that first-time setup gets logged
      const client = await connectMcpServer(server, config, true);
      await client.close();
      // Then run the cache setup codepath, so future results use a cached client with logging off
      await getMcpClient(server, config);
    }
    console.log("All MCP servers connected.");
  }

	const { waitUntilExit } = render(<App config={config} metadata={metadata} />);
  await waitUntilExit();
  console.log(`\nApprox. tokens used: ${totalTokensUsed().toLocaleString()}`);
});

cli.command("version")
.description("Prints the current version")
.action(async () => {
	const metadata = await readMetadata();
  console.log(metadata.version);
});

async function loadConfig(configPath?: string) {
  if(configPath) return await readConfig(configPath);

  const json5File = path.join(CONFIG_STANDARD_DIR, "octofriend.json5")
  if(await fileExists(json5File)) {
    return await readConfig(json5File);
  }

  const jsonFile = path.join(CONFIG_STANDARD_DIR, "octofriend.json")
  if(await fileExists(jsonFile)) {
    return await readConfig(jsonFile);
  }
  return await initConfig(json5File);
}

cli.parse();
