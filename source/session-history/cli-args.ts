import { Command } from "@commander-js/extra-typings";

export const CLI_ARGS_JSON_VERSION = "octo-cli-args/v1" as const;

export type LocalCommand = {
  kind: "local";
};

export type DockerConnectCommand = {
  kind: "docker-connect";
  target: string;
};

export type DockerRunCommand = {
  kind: "docker-run";
  dockerRunArgs: string[];
};

type CommandPayloads = LocalCommand | DockerConnectCommand | DockerRunCommand | InvalidCommand;

export type InvalidCommand = {
  kind: "invalid";
};

export type LaunchOptions = {
  config?: string;
  unchained?: boolean;
};

export type ValidCommandPayloads = Exclude<CommandPayloads, InvalidCommand>;

export type ParsedCliArgs = ValidCommandPayloads & LaunchOptions;

export function withLaunchOptions(cmd: Command) {
  return cmd
    .option("--config <path>", "Use a specific Octo config file")
    .option(
      "--unchained",
      "Skips confirmation for all tools, running them immediately. Dangerous.",
    );
}

export function formatCliCommand(command: ParsedCliArgs): string[] {
  const options: string[] = [];
  if (command.config != null) options.push("--config", command.config);
  if (command.unchained) options.push("--unchained");

  switch (command.kind) {
    case "local":
      return options;
    case "docker-connect":
      return [...options, "docker", "connect", command.target];
    case "docker-run":
      return [...options, "docker", "run", "--", ...command.dockerRunArgs];
  }
}

export function replaceOctoFlags(command: ParsedCliArgs, overrides: LaunchOptions): ParsedCliArgs {
  return {
    ...command,
    config: overrides.config ?? command.config,
    unchained: overrides.unchained || command.unchained,
  };
}

export function replaceDockerRunArgs(
  command: DockerRunCommand,
  dockerRunArgs: string[],
): DockerRunCommand {
  return { ...command, dockerRunArgs };
}

export function parseLaunchCommandArgs(args: string[]): CommandPayloads & LaunchOptions {
  let result: CommandPayloads = { kind: "invalid" } as CommandPayloads;

  const program = withLaunchOptions(new Command().exitOverride()).action(() => {
    result = { kind: "local" };
  });

  const docker = program.command("docker").exitOverride();
  docker
    .command("connect")
    .exitOverride()
    .argument("<target>", "Docker container")
    .action(t => {
      result = { kind: "docker-connect", target: t };
    });
  docker
    .command("run")
    .exitOverride()
    .argument("[args...]", "Docker run args")
    .action(runArgs => {
      result = { kind: "docker-run", dockerRunArgs: runArgs };
    });

  try {
    program.parse(args, { from: "user" });
  } catch {
    return { kind: "invalid" };
  }

  const opts = program.opts();
  return {
    ...result,
    config: opts.config as string | undefined,
    unchained: opts.unchained as boolean | undefined,
  };
}

type VersionedCliArgsJson = {
  version: typeof CLI_ARGS_JSON_VERSION;
} & ParsedCliArgs;

export function serializeCliArgs(cliArgs: ParsedCliArgs): string {
  return JSON.stringify({
    version: CLI_ARGS_JSON_VERSION,
    ...cliArgs,
  } satisfies VersionedCliArgsJson);
}

export function deserializeCliArgs(json: string): ParsedCliArgs {
  const parsed = JSON.parse(json) as unknown;
  if (!isObject(parsed)) throw new Error("Invalid CLI args JSON");
  if (parsed["version"] !== CLI_ARGS_JSON_VERSION) {
    throw new Error("Unsupported CLI args JSON version");
  }
  const kind = parsed["kind"];
  if (kind !== "local" && kind !== "docker-connect" && kind !== "docker-run") {
    throw new Error("Invalid CLI args kind in JSON");
  }
  const { version: _, ...cliArgs } = parsed as Record<string, unknown>;
  return cliArgs as unknown as ParsedCliArgs;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
