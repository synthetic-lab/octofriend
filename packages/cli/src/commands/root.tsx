import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "@commander-js/extra-typings";
import { runBenchmarkCommand } from "../benchmark.ts";
import {
	CONFIG_JSON5_FILE,
	loadConfig,
	loadConfigWithoutReauth,
} from "../config-screen.tsx";
import { runMain } from "../main.tsx";
import { createAgentdRustBridge } from "../bridge/agent/agent.ts";
import { loadConversationSessionLaunch } from "../session.ts";
import { APP_METADATA } from "../metadata.ts";
import { runPromptCommand } from "../prompt-files.ts";
import { DockerTransport, manageContainer } from "../workspace/docker.ts";
import { LocalTransport } from "../workspace/local.ts";
import { SshTransport } from "../workspace/ssh.ts";

const CHANGELOG_PATH = path.join(
	import.meta.dirname,
	"../../../../CHANGELOG.md",
);

async function runWithLocalTransport(
	config: string | undefined,
	unchained: boolean | undefined,
	resume: string | undefined,
	initialPrompt?: string,
) {
	const transport = new LocalTransport();
	try {
		process.title = "\\_o_O.//";
		process.stdout.write("\x1b]0;\\\\_o_O.//\x07");
		await runMain({
			config,
			unchained,
			resume,
			initialPrompt,
			launch: { kind: "local", config, unchained: !!unchained },
			transport,
		});
	} finally {
		await transport.close();
	}
}

async function runWithDockerContainer(
	target: string,
	opts: { config?: string; unchained?: boolean; resume?: string },
) {
	const transport = await DockerTransport.create({
		type: "container",
		container: target,
	});
	try {
		await runMain({
			config: opts.config,
			unchained: opts.unchained,
			resume: opts.resume,
			launch: {
				kind: "docker-connect",
				config: opts.config,
				unchained: !!opts.unchained,
				target,
			},
			transport,
		});
	} finally {
		await transport.close();
	}
}

async function runWithDockerImage(
	args: string[],
	opts: { config?: string; unchained?: boolean; resume?: string },
) {
	const transport = await DockerTransport.create({
		type: "image",
		image: await manageContainer(args),
	});
	try {
		await runMain({
			config: opts.config,
			unchained: opts.unchained,
			resume: opts.resume,
			launch: {
				kind: "docker-run",
				config: opts.config,
				unchained: !!opts.unchained,
				args,
			},
			transport,
		});
	} finally {
		await transport.close();
	}
}

async function runWithSshTransport(
	target: string,
	opts: { config?: string; unchained?: boolean; resume?: string },
) {
	const transport = await SshTransport.create(target);
	try {
		await runMain({
			config: opts.config,
			unchained: opts.unchained,
			resume: opts.resume,
			launch: {
				kind: "ssh",
				config: opts.config,
				unchained: !!opts.unchained,
				target,
			},
			transport,
		});
	} finally {
		await transport.close();
	}
}

async function runInteractive(opts: {
	config?: string;
	unchained?: boolean;
	resume?: string;
	prefill?: string;
}) {
	if (!opts.resume) {
		await runWithLocalTransport(
			opts.config,
			opts.unchained,
			undefined,
			opts.prefill,
		);
		return;
	}

	const bridge = await createAgentdRustBridge();
	let launch;
	try {
		launch = await loadConversationSessionLaunch(bridge, opts.resume);
	} finally {
		bridge.close();
	}

	const resumeOptions = { resume: opts.resume };
	switch (launch.kind) {
		case "local":
			await runWithLocalTransport(undefined, undefined, opts.resume);
			return;
		case "docker-connect":
			if (!launch.target)
				throw new Error("Saved Docker session has no container target");
			await runWithDockerContainer(launch.target, resumeOptions);
			return;
		case "docker-run":
			await runWithDockerImage(launch.args ?? [], resumeOptions);
			return;
		case "ssh":
			if (!launch.target) throw new Error("Saved SSH session has no target");
			await runWithSshTransport(launch.target, resumeOptions);
			return;
	}
}

function registerDockerCommands(cli: Command) {
	const docker = cli
		.command("docker")
		.description("Sandbox Octo inside Docker");
	docker
		.command("connect")
		.description("Sandbox Octo inside an already-running container")
		.option("--config <path>")
		.option("--resume <session-id>", "Resume a saved session")
		.option(
			"--unchained",
			"Skips confirmation for all tools, running them immediately. Dangerous.",
		)
		.argument("<target>", "The Docker container")
		.action(runWithDockerContainer);

	docker
		.command("run")
		.description(
			"Run a Docker image and sandbox Octo inside it, shutting it down when Octo shuts down",
		)
		.option("--config <path>")
		.option("--resume <session-id>", "Resume a saved session")
		.option(
			"--unchained",
			"Skips confirmation for all tools, running them immediately. Dangerous.",
		)
		.argument("[args...]", "The args to pass to `docker run`")
		.action(runWithDockerImage);
}

function registerSshCommands(cli: Command) {
	cli
		.command("ssh")
		.description("Run Octo over SSH on a remote host")
		.option("--config <path>")
		.option("--resume <session-id>", "Resume a saved session")
		.option(
			"--unchained",
			"Skips confirmation for all tools, running them immediately. Dangerous.",
		)
		.argument("<target>", "The SSH target, e.g. user@host")
		.action(runWithSshTransport);
}

function registerBasicCommands(cli: Command) {
	cli
		.command("version")
		.description("Prints the current version")
		.action(() => {
			console.log(APP_METADATA.version);
		});

	cli
		.command("init")
		.description("Create a fresh config file for Octo")
		.action(async () => {
			const { render } = await import("ink");
			const { loadTui } = await import("../launch-tui.ts");
			const { FirstTimeSetup } = await loadTui();
			const { createAgentdRustBridge } = await import(
				"../bridge/agent/agent.ts"
			);
			const bridge = await createAgentdRustBridge();
			try {
				const { waitUntilExit } = render(
					<FirstTimeSetup
						configPath={CONFIG_JSON5_FILE}
						modelConnectionTest={(params) => bridge.modelConnectionTest(params)}
					/>,
				);
				await waitUntilExit();
			} finally {
				bridge.close();
			}
		});

	cli
		.command("changelog")
		.description("List the changelog")
		.action(async () => {
			console.log(await fs.readFile(CHANGELOG_PATH, "utf8"));
		});

	cli
		.command("list")
		.description("List all models you've configured with Octo")
		.action(async () => {
			const { config } = await loadConfigWithoutReauth();
			console.log(config.models.map((model) => model.nickname).join("\n"));
		});
}

function registerBenchmarkCommands(cli: Command) {
	cli
		.command("bench")
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
		.option(
			"--concurrency <n>",
			"Concurrent requests to make. If omitted, defaults to 1",
		)
		.action(async (opts) => {
			const { config } = await loadConfigWithoutReauth();
			const transport = new LocalTransport();
			try {
				await runBenchmarkCommand(config, transport, opts);
			} finally {
				await transport.close();
			}
		});
}

function registerPromptCommand(cli: Command) {
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
			try {
				await runPromptCommand(config, transport, prompt, opts);
			} finally {
				await transport.close();
			}
		});
}

export function createoctofriendCommand(): Command {
	const cli = new Command()
		.description("If run with no subcommands, runs Octo interactively.")
		.option("--config <path>")
		.option("--resume <session-id>", "Resume a saved session")
		.option(
			"--prefill <prompt>",
			"Pre-fill the interactive prompt without submitting it",
		)
		.option(
			"--unchained",
			"Skips confirmation for all tools, running them immediately. Dangerous.",
		)
		.action(runInteractive);

	registerDockerCommands(cli);
	registerSshCommands(cli);
	registerBasicCommands(cli);
	registerBenchmarkCommands(cli);
	registerPromptCommand(cli);
	return cli;
}

export function runCli(argv = process.argv) {
	createoctofriendCommand().parse(argv);
}
