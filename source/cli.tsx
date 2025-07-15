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
import OpenAI from "openai";
import { LlmMessage } from "./llm.ts";
import { FirstTimeSetup } from "./first-time-setup.tsx";

const CONFIG_STANDARD_DIR = path.join(os.homedir(), ".config/octofriend/");
const CONFIG_JSON5_FILE = path.join(CONFIG_STANDARD_DIR, "octofriend.json5")

const cli = new Command()
.description("If run with no subcommands, runs Octo interactively.")
.option("--config <path>")
.option("--unchained", "Skips confirmation for all tools, running them immediately. Dangerous.")
.action(async (opts) => {
	const metadata = await readMetadata();
	const { config, configPath } = await loadConfig(opts.config);
  for(const model of config.models) {
    if(!process.env[model.apiEnvVar]) {
      console.error(`
Octo is set to use the ${model.apiEnvVar} env var to authenticate with the ${model.nickname} API,
but that env var isn't set in your current shell.

Hint: do you need to re-source your .bash_profile or .zshrc?
  `.trim());
      process.exit(1);
    }
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

	const { waitUntilExit } = render(
    <App config={config} configPath={configPath} metadata={metadata} unchained={!!opts.unchained} />
  );

  await waitUntilExit();
  console.log(`\nApprox. tokens used: ${totalTokensUsed().toLocaleString()}`);
});

cli.command("version")
.description("Prints the current version")
.action(async () => {
	const metadata = await readMetadata();
  console.log(metadata.version);
});

cli.command("init")
.description("Create a fresh config file for Octo")
.action(async () => {
  await initConfig(CONFIG_JSON5_FILE);
});

cli.command("list")
.description("List all models you've configured with Octo")
.action(async () => {
  const { config } = await loadConfig();
  console.log(config.models.map(m => m.nickname).join("\n"));
});

cli.command("prompt")
.description("Sends a prompt to a model")
.option("--system <prompt>", "An optional system prompt")
.option("--model <model-nickname>", "The nickname you gave for the model you want to use. If unspecified, uses your default model")
.argument("<prompt>", "The prompt you want to send to this model")
.action(async (prompt, opts) => {
  const { config } = await loadConfig();
  const model = opts.model ? config.models.find(m => m.nickname === opts.model) : config.models[0];

  if(model == null) {
    console.error(`No model with the nickname ${opts.model} found. Did you add it to Octo?`);
    console.error("The available models are:");
    console.error("- " + config.models.map(m => m.nickname).join("\n- "));
    process.exit(1);
  }

  if(!process.env[model.apiEnvVar]) {
    console.error(`${model.nickname} is set to use the ${model.apiEnvVar} env var, but that env var doesn't exist in your current shell. Do you need to re-source your .bash_profile or .zshrc?`);
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey: process.env[model.apiEnvVar],
    baseURL: model.baseUrl,
  });

  const messages: LlmMessage[] = [];
  if(opts.system) {
    messages.push({
      role: "system",
      content: opts.system,
    });
  }
  messages.push({
    role: "user",
    content: prompt,
  });

  const response = await client.chat.completions.create({
    model: model.model,
    messages,
    stream: true,
  });

  for await(const chunk of response) {
    const content = chunk.choices[0].delta?.content;
    if(content) process.stdout.write(content);
  }
  process.stdout.write("\n");
});

async function loadConfig(configPath?: string) {
  if(configPath) return { configPath, config: await readConfig(configPath) };

  if(await fileExists(CONFIG_JSON5_FILE)) {
    return { configPath: CONFIG_JSON5_FILE, config: await readConfig(CONFIG_JSON5_FILE) };
  }

  const jsonFile = path.join(CONFIG_STANDARD_DIR, "octofriend.json")
  if(await fileExists(jsonFile)) {
    return { configPath: jsonFile, config: await readConfig(jsonFile) };
  }
	const { waitUntilExit } = render(
    <FirstTimeSetup configPath={CONFIG_JSON5_FILE} />
  );
  await waitUntilExit();
  if(await fileExists(CONFIG_JSON5_FILE)) {
    return { configPath: CONFIG_JSON5_FILE, config: await readConfig(CONFIG_JSON5_FILE) };
  }
  process.exit(1);
}

cli.parse();
