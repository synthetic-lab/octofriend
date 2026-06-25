import { Command, CommandUnknownOpts } from "@commander-js/extra-typings";

export const CLI_ARGS_JSON_V1 = "octo-cli-args/v1" as const;

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

export type InvalidCommand = {
  kind: "invalid";
};

type CliPayload = LocalCommand | DockerConnectCommand | DockerRunCommand | InvalidCommand;

export type OctoFlags = {
  config?: string;
  unchained?: boolean;
};

export type ValidCliPayload = Exclude<CliPayload, InvalidCommand>;

export type ParsedCliArgs = ValidCliPayload & OctoFlags;

type VersionedCliArgsJson = {
  version: typeof CLI_ARGS_JSON_V1;
} & ParsedCliArgs;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withOctoFlags(cmd: Command) {
  return cmd
    .option("--config <path>", "Use a specific Octo config file")
    .option(
      "--unchained",
      "Skips confirmation for all tools, running them immediately. Dangerous.",
    );
}

export function buildFlagString(command: ParsedCliArgs): string[] {
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

export function replaceOctoFlags(command: ParsedCliArgs, overrides: OctoFlags): ParsedCliArgs {
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

function octoFlags(command: CommandUnknownOpts): OctoFlags {
  const opts = command.optsWithGlobals() as OctoFlags;
  return {
    config: opts.config,
    unchained: opts.unchained,
  };
}

export function serializeCliArgs(cliArgs: ParsedCliArgs): string {
  return JSON.stringify({
    version: CLI_ARGS_JSON_V1,
    ...cliArgs,
  } satisfies VersionedCliArgsJson);
}

export function deserializeCliArgs(json: string): ParsedCliArgs {
  const parsed = JSON.parse(json) as unknown;
  if (!isObject(parsed)) throw new Error("Invalid CLI args JSON");
  if (parsed["version"] !== CLI_ARGS_JSON_V1) {
    throw new Error("Unsupported CLI args JSON version");
  }
  const kind = parsed["kind"];
  if (kind !== "local" && kind !== "docker-connect" && kind !== "docker-run") {
    throw new Error("Invalid CLI args kind in JSON");
  }
  const { version: _, ...cliArgs } = parsed as Record<string, unknown>;
  return cliArgs as unknown as ParsedCliArgs;
}
