#!/usr/bin/env node
import { setupDb } from "./db/setup.ts";
setupDb();

import React from "react";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { render } from "ink";
import { Command } from "@commander-js/extra-typings";
import { fileExists } from "./fs-utils.ts";
import App from "./app.tsx";
import { readConfig, readMetadata, readKeyForModel, AUTOFIX_KEYS } from "./config.ts";
import { tokenCounts } from "./token-tracker.ts";
import { getMcpClient, connectMcpServer } from "./tools/tool-defs/mcp.ts";
import OpenAI from "openai";
import { LlmMessage } from "./compilers/standard.ts";
import { FirstTimeSetup } from "./first-time-setup.tsx";
import { PreflightModelAuth, PreflightAutofixAuth } from "./preflight-auth.tsx";
import { LocalTransport } from "./transports/local.ts";
import { DockerTransport, manageContainer } from "./transports/docker.ts";
import { readUpdates, markUpdatesSeen } from "./update-notifs/update-notifs.ts";
import { migrate } from "./db/migrate.ts";
const __dirname = import.meta.dirname;

const CONFIG_STANDARD_DIR = path.join(os.homedir(), ".config/octofriend/");
const CONFIG_JSON5_FILE = path.join(CONFIG_STANDARD_DIR, "octofriend.json5")

const DOCKER_REGEX = /^docker:(.+)$/;

const cli = new Command()
.description("If run with no subcommands, runs Octo interactively.")
.option("--config <path>")
.option("--unchained", "Skips confirmation for all tools, running them immediately. Dangerous.")
.option(
  "--connect <target>",
  "Connect to a Docker container. For example, octo --connect docker:some-container-name"
).action(async (opts) => {
	const metadata = await readMetadata();
	let { config, configPath } = await loadConfig(opts.config);

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

  const transport = await (async () => {
    if(opts.connect) {
      const match = DOCKER_REGEX.exec(opts.connect);
      if(match == null) {
        console.error("Invalid --connect flag: must be of form docker:running-container-name");
        process.exit(1);
      }
      const target = match[1];
      if(target.indexOf("/") >= 0) {
        return new DockerTransport({
          type: "image",
          image: await manageContainer(target),
        });
      }
      return new DockerTransport({ type: "container", container: target });
    }
    return new LocalTransport();
  })();

	const { waitUntilExit } = render(
    <App
      config={config}
      configPath={configPath}
      metadata={metadata}
      unchained={!!opts.unchained}
      transport={transport}
      updates={await readUpdates()}
    />,
    {
      exitOnCtrlC: false,
    }
  );

  await waitUntilExit();
  await transport.close();

  console.log("\nApprox. tokens used:");
  if(Object.keys(tokenCounts()).length === 0) {
    console.log("0");
  }
  else {
    for(const [ model, count ] of Object.entries(tokenCounts())) {
      const input = count.input.toLocaleString();
      const output = count.output.toLocaleString();
      console.log(`${model}: ${input} input, ${output} output`);
    }
  }
});

cli.command("version")
.description("Prints the current version")
.action(async () => {
	const metadata = await readMetadata();
  console.log(metadata.version);
});

cli.command("init")
.description("Create a fresh config file for Octo")
.action(() => {
  render(
    <FirstTimeSetup configPath={CONFIG_JSON5_FILE} />
  );
});

cli.command("changelog")
.description("List the changelog")
.action(async () => {
  const changelog = await fs.readFile(path.join(__dirname, "../../CHANGELOG.md"), "utf8");
  console.log(changelog);
});

cli.command("list")
.description("List all models you've configured with Octo")
.action(async () => {
  const { config } = await loadConfigWithoutReauth();
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

  const apiKey = await readKeyForModel(model, config);
  if(apiKey == null) {
    console.error(`${model.nickname} doesn't have an API key set up.`);
    if(model.apiEnvVar) {
      console.error(`It was set to use the ${model.apiEnvVar} env var, but that env var doesn't exist in the current shell. Hint: do you need to re-source your .bash_profile or .zshrc?`);
    }
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey,
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

async function loadConfig(path?: string) {
	let { config, configPath } = await loadConfigWithoutReauth(path);
  let defaultModel = config.models[0];
  if(!await readKeyForModel(defaultModel, config)) {
    const { waitUntilExit } = render(
      <PreflightModelAuth
        error="It looks like we need to set up auth for your default model"
        model={defaultModel}
        config={config}
        configPath={configPath}
      />
    );
    await waitUntilExit();
    const reloaded = await loadConfigWithoutReauth(path);
    config = reloaded.config;
    configPath = reloaded.configPath;
    defaultModel = config.models[0];
    if(!await readKeyForModel(defaultModel, config)) process.exit(1);
  }

  for(const key of AUTOFIX_KEYS) {
    let autofixModel = config[key];
    if(autofixModel) {
      if(!await readKeyForModel(autofixModel, config)) {
        const { waitUntilExit } = render(
          <PreflightAutofixAuth
            autofixKey={key}
            model={autofixModel}
            config={config}
            configPath={configPath}
          />
        );
        await waitUntilExit();
        const reloaded = await loadConfigWithoutReauth(path);
        config = reloaded.config;
        configPath = reloaded.configPath;
        autofixModel = config[key];
        if(autofixModel && !await readKeyForModel(autofixModel, config)) process.exit(1);
      }
    }
  }

  return { config, configPath };
}

async function loadConfigWithoutReauth(configPath?: string) {
  if(configPath) return { configPath, config: await readConfig(configPath) };

  if(await fileExists(CONFIG_JSON5_FILE)) {
    return { configPath: CONFIG_JSON5_FILE, config: await readConfig(CONFIG_JSON5_FILE) };
  }

  // This is first-time setup; mark all updates as seen to avoid showing an update message on boot
  await markUpdatesSeen();
	const { waitUntilExit } = render(
    <FirstTimeSetup configPath={CONFIG_JSON5_FILE} />
  );
  await waitUntilExit();

  if(await fileExists(CONFIG_JSON5_FILE)) {
    return { configPath: CONFIG_JSON5_FILE, config: await readConfig(CONFIG_JSON5_FILE) };
  }

  process.exit(1);
}

migrate().then(() => {
  cli.parse();
});
