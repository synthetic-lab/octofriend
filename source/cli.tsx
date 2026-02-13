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
import {
  readConfig,
  readMetadata,
  readKeyForModel,
  readKeyForModelWithDetails,
  assertKeyForModel,
  AUTOFIX_KEYS,
} from "./config.ts";
import { tokenCounts } from "./token-tracker.ts";
import { getMcpClient, connectMcpServer, shutdownMcpClients } from "./tools/tool-defs/mcp.ts";
import OpenAI from "openai";
import { LlmMessage } from "./compilers/standard.ts";
import { LlmIR } from "./ir/llm-ir.ts";
import { FirstTimeSetup } from "./first-time-setup.tsx";
import { PreflightModelAuth, PreflightAutofixAuth } from "./preflight-auth.tsx";
import { Transport } from "./transports/transport-common.ts";
import { LocalTransport } from "./transports/local.ts";
import { DockerTransport, manageContainer } from "./transports/docker.ts";
import { readUpdates, markUpdatesSeen } from "./update-notifs/update-notifs.ts";
import { migrate } from "./db/migrate.ts";
import { run } from "./compilers/run.ts";
import { loadInputHistory } from "./input-history/index.ts";
import { makeAutofixJson } from "./compilers/autofix.ts";
import { discoverSkills } from "./skills/skills.ts";
import { timeout } from "./signals.ts";

async function runWithConcurrencyLimit<T>(
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    const index = i;
    const promise = task(index).then(result => {
      results.push(result);
    });
    executing.push(promise);

    if (executing.length >= 100) {
      await Promise.race(executing);
      executing.splice(0, executing.findIndex(p => p === promise) + 1);
    }
  }

  await Promise.all(executing);
  return results;
}

const LARGE_CONTEXT_GROUPS = [
  // Group 0: Core kernel
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/sched/core.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/fork.c",
  ],
  // Group 1: Filesystems
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/fs/ext4/inode.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/fs/ext4/super.c",
  ],
  // Group 2: Memory management
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/mm/memory.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/mm/page_alloc.c",
  ],
  // Group 3: Networking
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/net/ipv4/tcp_input.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/net/ipv4/tcp_output.c",
  ],
  // Group 4: Block layer
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/block/blk-mq.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/block/elevator.c",
  ],
  // Group 5: Drivers - GPU
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/gpu/drm/i915/i915_gem.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/gpu/drm/drm_file.c",
  ],
  // Group 6: Virtualization
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/virt/kvm/kvm_main.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/arch/x86/kvm/x86.c",
  ],
  // Group 7: Security
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/security/selinux/ss/services.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/security/keys/key.c",
  ],
  // Group 8: Crypto
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/crypto/api.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/crypto/cipher.c",
  ],
  // Group 9: Device tree
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/of/base.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/of/platform.c",
  ],
  // Group 10: Sound/ALSA
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/sound/core/init.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/sound/core/pcm.c",
  ],
  // Group 11: USB
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/usb/core/hub.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/usb/core/urb.c",
  ],
  // Group 12: PCI
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/pci/pci.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/pci/probe.c",
  ],
  // Group 13: ACPI
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/acpi/acpi.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/acpi/scan.c",
  ],
  // Group 14: Tracing/ftrace
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/trace/ftrace.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/trace/trace.c",
  ],
  // Group 15: BPF
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/bpf/core.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/bpf/syscall.c",
  ],
  // Group 16: SCSI
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/scsi/scsi.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/drivers/scsi/sd.c",
  ],
  // Group 17: Time/clock
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/time/timer.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/time/clocksource.c",
  ],
  // Group 18: RCU
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/rcu/tree.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/rcu/update.c",
  ],
  // Group 19: Module loader
  [
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/module/main.c",
    "https://raw.githubusercontent.com/torvalds/linux/master/kernel/kmod.c",
  ],
];

async function fetchLargeContextGroup(groupIndex: number): Promise<string> {
  const urls = LARGE_CONTEXT_GROUPS[groupIndex % LARGE_CONTEXT_GROUPS.length];

  const contents: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.ok) {
        const text = await response.text();
        contents.push(`\n\n=== ${url} ===\n\n${text}`);
      }
    } catch {
      // Skip failed fetches
    }
  }

  return contents.join("\n");
}

const __dirname = import.meta.dirname;

const CONFIG_STANDARD_DIR = path.join(os.homedir(), ".config/octofriend/");
const CONFIG_JSON5_FILE = path.join(CONFIG_STANDARD_DIR, "octofriend.json5");

const cli = new Command()
  .description("If run with no subcommands, runs Octo interactively.")
  .option("--config <path>")
  .option("--unchained", "Skips confirmation for all tools, running them immediately. Dangerous.")
  .option(
    "--connect <target>",
    "Connect to a Docker container. For example, octo --connect docker:some-container-name",
  )
  .action(async opts => {
    const transport = new LocalTransport();
    try {
      // Set terminal title for tmux
      process.title = "\\_o_O.//";
      // Set terminal title for xterm-compatible term emulators
      process.stdout.write("\x1b]0;" + "\\\\_o_O.//" + "\x07");

      await runMain({
        config: opts.config,
        unchained: opts.unchained,
        transport,
      });
    } finally {
      await transport.close();
    }
  });

const docker = cli.command("docker").description("Sandbox Octo inside Docker");
docker
  .command("connect")
  .description("Sandbox Octo inside an already-running container")
  .option("--config <path>")
  .option("--unchained", "Skips confirmation for all tools, running them immediately. Dangerous.")
  .argument("<target>", "The Docker container")
  .action(async (target, opts) => {
    const transport = new DockerTransport({ type: "container", container: target });

    try {
      await runMain({
        config: opts.config,
        unchained: opts.unchained,
        transport,
      });
    } finally {
      await transport.close();
    }
  });

docker
  .command("run")
  .description(
    "Run a Docker image and sandbox Octo inside it, shutting it down when Octo shuts down",
  )
  .option("--config <path>")
  .option("--unchained", "Skips confirmation for all tools, running them immediately. Dangerous.")
  .argument("[args...]", "The args to pass to `docker run`")
  .action(async (args, opts) => {
    const transport = new DockerTransport({
      type: "image",
      image: await manageContainer(args),
    });

    try {
      await runMain({
        config: opts.config,
        unchained: opts.unchained,
        transport,
      });
    } finally {
      await transport.close();
    }
  });

async function runMain(opts: { config?: string; unchained?: boolean; transport: Transport }) {
  try {
    const metadata = await readMetadata();
    let { config, configPath } = await loadConfig(opts.config);

    // Connect to all MCP servers on boot
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      for (const server of Object.keys(config.mcpServers)) {
        try {
          console.log("Connecting to", server, "MCP server...");
          // Run the basic connection setup with logging enabled, so that first-time setup gets logged
          const client = await connectMcpServer(server, config, true);
          await client.close();
          // Then run the cache setup codepath, so future results use a cached client with logging off
          await getMcpClient(server, config);
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
    const cwd = await opts.transport.cwd(timeout(5000));

    const { waitUntilExit } = render(
      <App
        bootSkills={skills.map(s => s.name)}
        config={config}
        configPath={configPath}
        cwd={cwd}
        metadata={metadata}
        unchained={!!opts.unchained}
        transport={opts.transport}
        updates={await readUpdates()}
        inputHistory={await loadInputHistory()}
      />,
      {
        exitOnCtrlC: false,
      },
    );

    await waitUntilExit();

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
    await shutdownMcpClients();
  }
}

cli
  .command("version")
  .description("Prints the current version")
  .action(async () => {
    const metadata = await readMetadata();
    console.log(metadata.version);
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
    const changelog = await fs.readFile(path.join(__dirname, "../../CHANGELOG.md"), "utf8");
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
  .option(
    "--large-context",
    "Downloads large files (~100k tokens) and includes them in the benchmark prompt",
  )
  .action(async opts => {
    const { config } = await loadConfigWithoutReauth();
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
    const apiKey = await assertKeyForModel(model, config);
    const autofixJson = makeAutofixJson(config);
    const modelToUse = model;

    const basePrompt =
      opts.prompt ?? "Write me a short story about a frog going to the moon. Do not use ANY tools.";
    const useLargeContext = opts.largeContext;

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

    async function runSingleBenchmark(index: number): Promise<BenchmarkResult> {
      const start = new Date();
      let firstToken: Date | null = null;
      const tokenTimestamps: Date[] = [];

      let benchmarkPrompt = basePrompt;
      if (useLargeContext) {
        const largeContext = await fetchLargeContextGroup(index);
        benchmarkPrompt = `Here are some large code files for context:\n\n${largeContext}\n\nNow, ${basePrompt}`;
      }

      const result = await run({
        apiKey,
        model: modelToUse,
        autofixJson,
        messages: [
          {
            role: "user",
            content: benchmarkPrompt,
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
      });

      if (!result.success) {
        return {
          success: false,
          error: result.requestError,
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

      const firstResult = result.output[0];
      if (firstResult.role !== "assistant") {
        return {
          success: false,
          error: "No assistant response",
        };
      }

      const tokens = firstResult.outputTokens;

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
    const results = await runWithConcurrencyLimit(concurrency, runSingleBenchmark);
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
      const minLatency = Math.min(...allInterTokenLatencies);
      const maxLatency = Math.max(...allInterTokenLatencies);
      const avgLatency =
        allInterTokenLatencies.reduce((a, b) => a + b, 0) / allInterTokenLatencies.length;

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
    const model = opts.model
      ? config.models.find(m => m.nickname === opts.model)
      : config.models[0];

    if (model == null) {
      console.error(`No model with the nickname ${opts.model} found. Did you add it to Octo?`);
      console.error("The available models are:");
      console.error("- " + config.models.map(m => m.nickname).join("\n- "));
      process.exit(1);
    }

    const keyResult = await readKeyForModelWithDetails(model, config);
    if (!keyResult.ok) {
      console.error(`${model.nickname} doesn't have an API key set up.`);
      const error = keyResult.error;

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
    const apiKey = keyResult.key;

    const messages: LlmIR[] = [];
    messages.push({
      role: "user",
      content: prompt,
    });

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
      apiKey,
      model,
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
    });
    if (!result.success) {
      console.error(result.requestError);
      console.error(`cURL: ${result.curl}`);
      process.exit(1);
    }

    process.stdout.write("\n");
  });

async function loadConfig(path?: string) {
  let { config, configPath } = await loadConfigWithoutReauth(path);
  let defaultModel = config.models[0];
  if (!(await readKeyForModel(defaultModel, config))) {
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
    if (!(await readKeyForModel(defaultModel, config))) process.exit(1);
  }

  for (const key of AUTOFIX_KEYS) {
    let autofixModel = config[key];
    if (autofixModel) {
      if (!(await readKeyForModel(autofixModel, config))) {
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
        if (autofixModel && !(await readKeyForModel(autofixModel, config))) process.exit(1);
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
