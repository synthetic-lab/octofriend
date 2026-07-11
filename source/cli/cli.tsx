#!/usr/bin/env node
import { setupDb } from "../db/setup.ts";
setupDb();

import React from "react";
import path from "path";
import os from "os";
import fs from "fs/promises";
import chalk from "chalk";
import { render } from "ink";
import { Command } from "@commander-js/extra-typings";
import { fileExists } from "../fs-utils.ts";
import App from "../app.tsx";
import { readConfig, readAuthForModel, AUTOFIX_KEYS, APP_METADATA } from "../config.ts";
import { tokenCounts } from "../token-tracker.ts";
import { getMcpClient, connectMcpServer, shutdownMcpClients } from "../tools/tool-defs/mcp.ts";
import { FirstTimeSetup } from "../first-time-setup.tsx";
import { PreflightModelAuth, PreflightAutofixAuth } from "../preflight-auth.tsx";
import { Transport } from "../transports/transport-common.ts";
import { LocalTransport } from "../transports/local.ts";
import { DockerTransport, manageContainer } from "../transports/docker.ts";
import { readUpdates, markUpdatesSeen } from "../update-notifs/update-notifs.ts";
import { migrate } from "../db/migrate.ts";
import { run } from "../compilers/run.ts";
import type { ModelData } from "../compilers/run.ts";
import { loadInputHistory } from "../input-history/index.ts";
import { makeAutofixJson } from "../compilers/autofix.ts";
import { discoverSkills } from "../skills/skills.ts";
import { timeout } from "../signals.ts";
import { shutdownLspClients } from "../lsp/client.ts";
import { replaceDockerRunArgs, replaceOctoFlags, withOctoFlags } from "./cli-args.ts";
import type { ParsedCliArgs } from "./cli-args.ts";
import { loadSession } from "../session-history/index.ts";
import type { LoadedSession, Session } from "../session-history/index.ts";
import { useAppStore } from "../state.ts";
import { THEME_COLOR } from "../theme.ts";

const __dirname = import.meta.dirname;

const CONFIG_STANDARD_DIR = path.join(os.homedir(), ".config/octofriend/");
const CONFIG_JSON5_FILE = path.join(CONFIG_STANDARD_DIR, "octofriend.json5");

const cli = withOctoFlags(
  new Command().description("If run with no subcommands, runs Octo interactively."),
)
  .option("--resume <session-id>", "Resume a previous Octo session")
  .argument("[docker-run-args...]", "Optional replacement args for `docker run` when resuming")
  .action(async (dockerRunArgs, opts) => {
    const resumeSessionId = opts.resume ?? null;
    if (resumeSessionId == null && dockerRunArgs.length > 0) {
      console.error("Use octo docker run <args> to start a new session with Docker.");
      process.exitCode = 1;
      return;
    }
    let runConfig = null;
    if (resumeSessionId != null) {
      runConfig = await buildConfigForResuming(resumeSessionId, {
        config: opts.config,
        unchained: opts.unchained,
        dockerRunArgs: dockerRunArgs.length > 0 ? dockerRunArgs : undefined,
      });
      if (runConfig == null) return;
    } else {
      runConfig = {
        loadedSession: null,
        transport: new LocalTransport(),
        parsedCliArgs: {
          kind: "local" as const,
          config: opts.config,
          unchained: opts.unchained,
        },
      };
    }

    try {
      // Set terminal title for tmux
      process.title = "\\_o_O.//";
      // Set terminal title for xterm-compatible term emulators
      process.stdout.write("\x1b]0;" + "\\\\_o_O.//" + "\x07");
      await runMain(runConfig);
    } finally {
      await runConfig.transport.close();
    }
  });

const docker = cli.command("docker").description("Sandbox Octo inside Docker");
withOctoFlags(docker.command("connect"))
  .description("Sandbox Octo inside an already-running container")
  .argument("<target>", "The Docker container")
  .action(async (target, opts) => {
    const transport = await DockerTransport.create({ type: "container", container: target });
    try {
      await runMain({
        transport,
        loadedSession: null,
        parsedCliArgs: {
          kind: "docker-connect",
          target,
          config: opts.config,
          unchained: opts.unchained,
        },
      });
    } finally {
      await transport.close();
    }
  });

withOctoFlags(docker.command("run"))
  .description(
    "Run a Docker image and sandbox Octo inside it, shutting it down when Octo shuts down",
  )
  .argument("[args...]", "The args to pass to `docker run`")
  .action(async (args, opts) => {
    const transport = await DockerTransport.create({
      type: "image",
      image: await manageContainer(args),
    });

    try {
      await runMain({
        transport,
        loadedSession: null,
        parsedCliArgs: {
          kind: "docker-run",
          dockerRunArgs: args,
          config: opts.config,
          unchained: opts.unchained,
        },
      });
    } finally {
      await transport.close();
    }
  });

async function buildConfigForResuming(
  resumeSessionId: string,
  overrides: { config?: string; unchained?: boolean; dockerRunArgs?: string[] },
): Promise<{
  loadedSession: LoadedSession;
  transport: Transport;
  parsedCliArgs: ParsedCliArgs;
} | null> {
  const loadedSession = loadSession(resumeSessionId);
  if (loadedSession == null) {
    console.error(`No session found with ID ${resumeSessionId}.`);
    process.exit(1);
  }

  const storedCliArgs = loadedSession.session.metadata.cliArgs;
  let effectiveCliArgs = replaceOctoFlags(storedCliArgs, overrides);
  if (overrides.dockerRunArgs != null) {
    if (effectiveCliArgs.kind !== "docker-run") {
      console.error(`
        Cannot override Docker run args for session ${resumeSessionId}: that session was not initialized with \`octo docker run\`.,
      `);
      process.exit(1);
    } else {
      effectiveCliArgs = replaceDockerRunArgs(effectiveCliArgs, overrides.dockerRunArgs);
    }
  }

  const shared = {
    parsedCliArgs: effectiveCliArgs,
    loadedSession,
  };

  switch (effectiveCliArgs.kind) {
    case "local":
      return {
        ...shared,
        transport: new LocalTransport(),
      };
    case "docker-connect":
      return {
        ...shared,
        transport: await DockerTransport.create({
          type: "container",
          container: effectiveCliArgs.target,
        }),
      };
    case "docker-run":
      return {
        ...shared,
        transport: await DockerTransport.create({
          type: "image",
          image: await manageContainer(effectiveCliArgs.dockerRunArgs),
        }),
      };
  }
}

async function runMain(opts: {
  parsedCliArgs: ParsedCliArgs;
  transport: Transport;
  loadedSession?: LoadedSession | null;
}) {
  let session: Session;
  if (opts.loadedSession != null) {
    session = {
      ...opts.loadedSession.session,
      metadata: { ...opts.loadedSession.session.metadata, cliArgs: opts.parsedCliArgs },
    };
    useAppStore.getState().hydrateSession(opts.loadedSession.history);
  } else {
    session = useAppStore.getState().startNewSession(opts.transport.cwd, opts.parsedCliArgs);
  }

  try {
    let { config, configPath } = await loadConfig(opts.parsedCliArgs.config);

    // Connect to all MCP servers on boot
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      for (const server of Object.keys(config.mcpServers)) {
        try {
          console.log("Connecting to", server, "MCP server...");
          // Run the basic connection setup with logging enabled, so that first-time setup gets logged
          const client = await connectMcpServer(server, config, true);
          if (!client.success) throw new Error(client.error);
          await client.data.close();
          // Then run the cache setup codepath, so future results use a cached client with logging off
          const cachedClient = await getMcpClient(server, config);
          if (!cachedClient.success) throw new Error(cachedClient.error);
          console.log("Connected to", server, "MCP server");
        } catch (error) {
          console.warn(
            `Warning: Failed to connect to "${server}" MCP server: ${error instanceof Error ? error.message : String(error)}`,
          );
          console.warn("Octo will continue without this MCP server.");
        }
      }
      console.log("MCP server initialization complete.");
    }

    const skills = await discoverSkills(opts.transport, timeout(5000), config);
    const cwd = opts.transport.cwd;

    const { waitUntilExit } = render(
      <App
        bootSkills={skills.map(s => s.name)}
        config={config}
        configPath={configPath}
        cwd={cwd}
        metadata={APP_METADATA}
        unchained={!!opts.parsedCliArgs.unchained}
        transport={opts.transport}
        session={session}
        onSessionChange={nextSession => {
          session = nextSession;
        }}
        updates={await readUpdates()}
        inputHistory={await loadInputHistory()}
      />,
      {
        exitOnCtrlC: false,
        kittyKeyboard: {
          mode: "auto",
        },
      },
    );

    await waitUntilExit();
    const { history } = useAppStore.getState();
    if (history.some(item => item.type === "llm-ir")) {
      const resumeCommand = chalk.hex(THEME_COLOR)(`octo --resume ${session.metadata.sessionId}`);
      console.log(`\nResume this session with ${resumeCommand}`);
    }

    console.log("\nApprox. tokens used:");
    if (Object.keys(tokenCounts()).length === 0) {
      console.log("0");
    } else {
      for (const [model, count] of Object.entries(tokenCounts())) {
        const input = count.input.toLocaleString();
        const output = count.output.toLocaleString();
        console.log(`${model}: ${input} input, ${output} output`);
      }
    }
  } finally {
    await shutdownLspClients();
    await shutdownMcpClients();
  }
}

cli
  .command("version")
  .description("Prints the current version")
  .action(async () => {
    console.log(APP_METADATA.version);
  });

cli
  .command("init")
  .description("Create a fresh config file for Octo")
  .action(() => {
    render(<FirstTimeSetup configPath={CONFIG_JSON5_FILE} />);
  });

cli
  .command("changelog")
  .description("List the changelog")
  .action(async () => {
    const changelog = await fs.readFile(path.join(__dirname, "../../../CHANGELOG.md"), "utf8");
    console.log(changelog);
  });

cli
  .command("list")
  .description("List all models you've configured with Octo")
  .action(async () => {
    const { config } = await loadConfigWithoutReauth();
    console.log(config.models.map(m => m.nickname).join("\n"));
  });

const bench = cli.command("bench");
bench
  .command("tps")
  .description("Benchmark tokens/sec from your API provider")
  .option(
    "--model <model-nickname>",
    "The nickname you gave for the model you want to use. If unspecified, uses your default model",
  )
  .option(
    "--prompt <prompt>",
    "Custom prompt to benchmark with. If omitted, uses the default prompt.",
  )
  .option("--concurrency <n>", "Concurrent requests to make. If omitted, defaults to 1")
  .action(async opts => {
    const { config } = await loadConfigWithoutReauth();
    const transport = new LocalTransport();
    const model = opts.model
      ? config.models.find(m => m.nickname === opts.model)
      : config.models[0];

    if (model == null) {
      console.error(`No model with the nickname ${opts.model} found. Did you add it to Octo?`);
      console.error("The available models are:");
      console.error("- " + config.models.map(m => m.nickname).join("\n- "));
      process.exit(1);
    }

    const concurrency = Math.max(1, parseInt(opts.concurrency ?? "1", 10));
    let modelData: ModelData;
    if (model.type === "codex") {
      const authResult = await readAuthForModel(model, config);
      if (!authResult.ok) {
        console.error(authResult.error.message);
        process.exit(1);
      }
      modelData = { type: "codex", auth: authResult.auth, model };
    } else {
      const authResult = await readAuthForModel(model, config);
      if (!authResult.ok) {
        console.error(authResult.error.message);
        process.exit(1);
      }
      modelData = { type: "api", auth: authResult.auth, model };
    }
    const autofixJson = makeAutofixJson(config);

    console.log(
      `Benchmarking ${model.nickname} with ${concurrency} concurrent request${concurrency > 1 ? "s" : ""}`,
    );
    const abortController = new AbortController();
    const timer = setInterval(() => {
      console.log("Still working...");
    }, 5000);

    type SuccessfulBenchmark = {
      tokens: number;
      ttft: number;
      tokenElapsed: number;
      interTokenLatencies: number[];
      success: true;
    };

    type FailedBenchmark = {
      success: false;
      error: string;
    };

    type BenchmarkResult = SuccessfulBenchmark | FailedBenchmark;

    async function runSingleBenchmark(): Promise<BenchmarkResult> {
      const start = new Date();
      let firstToken: Date | null = null;
      const tokenTimestamps: Date[] = [];

      const result = await run({
        modelData,
        autofixJson,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                content:
                  opts.prompt ??
                  "Write me a short story about a frog going to the moon. Do not use ANY tools.",
              },
            ],
          },
        ],
        handlers: {
          onTokens: () => {
            const now = new Date();
            tokenTimestamps.push(now);
            if (firstToken == null) firstToken = now;
          },
          onAutofixJson: () => {},
        },
        abortSignal: abortController.signal,
        transport,
      });

      if (!result.success) {
        return {
          success: false,
          error:
            result.error.type === "auth-error" ? result.error.authError : result.error.requestError,
        };
      }

      const end = new Date();

      if (firstToken == null) {
        return {
          success: false,
          error: "No tokens received",
        };
      }

      const ttft = (firstToken as Date).getTime() - start.getTime();
      const tokenElapsed = end.getTime() - (firstToken as Date).getTime();

      const tokens = result.data.usage.output;

      const interTokenLatencies: number[] = [];
      for (let i = 1; i < tokenTimestamps.length; i++) {
        const latency = tokenTimestamps[i].getTime() - tokenTimestamps[i - 1].getTime();
        interTokenLatencies.push(latency);
      }

      return {
        tokens,
        ttft,
        tokenElapsed,
        interTokenLatencies,
        success: true,
      };
    }

    const benchmarkStart = new Date();
    const results = await Promise.all(
      Array.from({ length: concurrency }, () => runSingleBenchmark()),
    );
    const benchmarkEnd = new Date();

    clearInterval(timer);

    const failures = results.filter((r): r is FailedBenchmark => !r.success);
    if (failures.length > 0) {
      console.error(`\n${failures.length} request(s) failed:`);
      for (const f of failures) {
        console.error(`  - ${f.error}`);
      }
      if (failures.length === concurrency) {
        process.exit(1);
      }
    }

    const successes = results.filter((r): r is SuccessfulBenchmark => r.success);

    if (successes.length === 0) {
      console.log("No successful requests");
      process.exit(1);
    }

    const totalTokens = successes.reduce((sum, r) => sum + r.tokens, 0);
    const avgTokens = totalTokens / successes.length;
    const avgTtft = successes.reduce((sum, r) => sum + r.ttft, 0) / successes.length;

    const allInterTokenLatencies = successes.flatMap(r => r.interTokenLatencies);
    const avgTokenElapsed =
      successes.reduce((sum, r) => sum + r.tokenElapsed, 0) / successes.length;

    const totalTime = (benchmarkEnd.getTime() - benchmarkStart.getTime()) / 1000;
    const tps = totalTokens / totalTime;

    console.log(`\n
Successful requests: ${successes.length}/${concurrency}
Total tokens: ${totalTokens}
Avg tokens per request: ${avgTokens.toFixed(2)}
Total time: ${totalTime.toFixed(2)}s
Avg time to first token: ${(avgTtft / 1000).toFixed(3)}s
`);

    if (allInterTokenLatencies.length > 0) {
      let minLatency = allInterTokenLatencies[0];
      let maxLatency = allInterTokenLatencies[0];
      let total = 0;
      for (const latency of allInterTokenLatencies) {
        if (minLatency > latency) minLatency = latency;
        if (maxLatency < latency) maxLatency = latency;
        total += latency;
      }
      const avgLatency = total / allInterTokenLatencies.length;

      console.log(`Inter-token latencies (${allInterTokenLatencies.length} total):
  Min: ${minLatency}ms
  Max: ${maxLatency}ms
  Avg: ${avgLatency.toFixed(2)}ms
  Avg stream time per request: ${(avgTokenElapsed / 1000).toFixed(3)}s
`);
    }

    console.log(`Tok/sec output (overall): ${tps.toFixed(2)}
Tok/sec output (per-request avg): ${successes.map(r => r.tokens / (r.tokenElapsed / 1000)).reduce((a, b) => a + b, 0) / successes.length}
`);
  });

cli
  .command("prompt")
  .description("Sends a prompt to a model")
  .option("--system <prompt>", "An optional system prompt")
  .option(
    "--model <model-nickname>",
    "The nickname you gave for the model you want to use. If unspecified, uses your default model",
  )
  .argument("<prompt>", "The prompt you want to send to this model")
  .action(async (prompt, opts) => {
    const { config } = await loadConfig();
    const transport = new LocalTransport();
    const model = opts.model
      ? config.models.find(m => m.nickname === opts.model)
      : config.models[0];

    if (model == null) {
      console.error(`No model with the nickname ${opts.model} found. Did you add it to Octo?`);
      console.error("The available models are:");
      console.error("- " + config.models.map(m => m.nickname).join("\n- "));
      process.exit(1);
    }

    let modelData: ModelData;
    if (model.type === "codex") {
      const authResult = await readAuthForModel(model, config);
      if (!authResult.ok) {
        console.error(`${model.nickname} doesn't have auth set up.`);
        const error = authResult.error;

        if (error.type === "missing") {
          console.error(`${error.message}`);
        } else if (error.type === "command_failed") {
          console.error(`Command execution failed: ${error.message}`);
          if (error.exitCode != null) {
            console.error(`Exit code: ${error.exitCode}`);
          }
          if (error.stderr) {
            console.error(`stderr: ${error.stderr}`);
          }
        } else if (error.type === "invalid") {
          console.error(`Invalid auth configuration: ${error.message}`);
        }

        process.exit(1);
      }
      modelData = { type: "codex", auth: authResult.auth, model };
    } else {
      const authResult = await readAuthForModel(model, config);
      if (!authResult.ok) {
        console.error(`${model.nickname} doesn't have auth set up.`);
        const error = authResult.error;

        if (error.type === "missing") {
          console.error(`${error.message}`);
          if (model.auth?.type === "env") {
            console.error(`Hint: do you need to re-source your .bash_profile or .zshrc?`);
          }
        } else if (error.type === "command_failed") {
          console.error(`Command execution failed: ${error.message}`);
          if (error.exitCode != null) {
            console.error(`Exit code: ${error.exitCode}`);
          }
          if (error.stderr) {
            console.error(`stderr: ${error.stderr}`);
          }
        } else if (error.type === "invalid") {
          console.error(`Invalid auth configuration: ${error.message}`);
        }

        process.exit(1);
      }
      modelData = { type: "api", auth: authResult.auth, model };
    }
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, content: prompt }],
      },
    ];

    let systemPrompt: undefined | (() => Promise<string>) = undefined;
    if (opts.system) {
      const sys = opts.system;
      systemPrompt = async () => sys;
    }

    const autofixJson = makeAutofixJson(config);
    const abortController = new AbortController();

    let seenReasoning = false;
    let seenContent = false;
    const result = await run({
      modelData,
      systemPrompt,
      messages,
      autofixJson,
      handlers: {
        onTokens: (chunk, type) => {
          if (type === "reasoning") seenReasoning = true;

          if (seenReasoning && type === "content" && !seenContent) {
            seenContent = true;
            process.stderr.write("\n\n");
          }

          if (type === "reasoning") process.stderr.write(chunk);
          else process.stdout.write(chunk);
        },
        onAutofixJson: () => {},
      },
      abortSignal: abortController.signal,
      transport,
    });
    if (!result.success) {
      if (result.error.type === "auth-error") {
        console.error(result.error.authError);
      } else {
        console.error(result.error.requestError);
        console.error(`cURL: ${result.error.curl}`);
      }
      process.exit(1);
    }

    process.stdout.write("\n");
  });

async function loadConfig(path?: string) {
  let { config, configPath } = await loadConfigWithoutReauth(path);
  let defaultModel = config.models[0];
  if (!(await readAuthForModel(defaultModel, config)).ok) {
    const { waitUntilExit } = render(
      <PreflightModelAuth
        error="It looks like we need to set up auth for your default model"
        model={defaultModel}
        config={config}
        configPath={configPath}
      />,
    );
    await waitUntilExit();
    const reloaded = await loadConfigWithoutReauth(path);
    config = reloaded.config;
    configPath = reloaded.configPath;
    defaultModel = config.models[0];
    if (!(await readAuthForModel(defaultModel, config)).ok) process.exit(1);
  }

  for (const key of AUTOFIX_KEYS) {
    let autofixModel = config[key];
    if (autofixModel) {
      if (!(await readAuthForModel(autofixModel, config)).ok) {
        const { waitUntilExit } = render(
          <PreflightAutofixAuth
            autofixKey={key}
            model={autofixModel}
            config={config}
            configPath={configPath}
          />,
        );
        await waitUntilExit();
        const reloaded = await loadConfigWithoutReauth(path);
        config = reloaded.config;
        configPath = reloaded.configPath;
        autofixModel = config[key];
        if (autofixModel && !(await readAuthForModel(autofixModel, config)).ok) process.exit(1);
      }
    }
  }

  return { config, configPath };
}

async function loadConfigWithoutReauth(configPath?: string) {
  if (configPath) return { configPath, config: await readConfig(configPath) };

  if (await fileExists(CONFIG_JSON5_FILE)) {
    return { configPath: CONFIG_JSON5_FILE, config: await readConfig(CONFIG_JSON5_FILE) };
  }

  // This is first-time setup; mark all updates as seen to avoid showing an update message on boot
  await markUpdatesSeen();
  const { waitUntilExit } = render(<FirstTimeSetup configPath={CONFIG_JSON5_FILE} />);
  await waitUntilExit();

  if (await fileExists(CONFIG_JSON5_FILE)) {
    return { configPath: CONFIG_JSON5_FILE, config: await readConfig(CONFIG_JSON5_FILE) };
  }

  process.exit(1);
}

migrate().then(() => {
  cli.parse();
});
