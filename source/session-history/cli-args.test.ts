import { describe, expect, it } from "vitest";
import {
  formatCliCommand,
  replaceOctoFlags,
  parseLaunchCommandArgs,
  replaceDockerRunArgs,
  serializeCliArgs,
  deserializeCliArgs,
  CLI_ARGS_JSON_VERSION,
} from "./cli-args.ts";

describe("cli args", () => {
  it("formats a local command with options", () => {
    const command = {
      kind: "local",
      config: "./octofriend.json5",
      unchained: true,
    } as const;

    expect(formatCliCommand(command)).toEqual(["--config", "./octofriend.json5", "--unchained"]);
  });

  it("formats a Docker connect command with options", () => {
    const command = {
      kind: "docker-connect",
      target: "octo-dev",
      config: "/tmp/octofriend.json5",
      unchained: true,
    } as const;

    expect(formatCliCommand(command)).toEqual([
      "--config",
      "/tmp/octofriend.json5",
      "--unchained",
      "docker",
      "connect",
      "octo-dev",
    ]);
  });

  it("preserves arbitrary Docker run arguments in format", () => {
    const command = {
      kind: "docker-run" as const,
      dockerRunArgs: ["--rm", "--config", "container-value", "-v", "/host path:/repo", "alpine"],
    };

    expect(formatCliCommand(command)).toEqual([
      "docker",
      "run",
      "--",
      "--rm",
      "--config",
      "container-value",
      "-v",
      "/host path:/repo",
      "alpine",
    ]);
  });

  it("parses local launch args from CLI strings", () => {
    expect(parseLaunchCommandArgs([])).toEqual({ kind: "local" });
    expect(parseLaunchCommandArgs(["docker", "connect", "octo-dev"])).toEqual({
      kind: "docker-connect",
      target: "octo-dev",
    });
    expect(parseLaunchCommandArgs(["docker", "run", "--", "--rm", "alpine"])).toEqual({
      kind: "docker-run",
      dockerRunArgs: ["--rm", "alpine"],
    });
  });

  it("applies resume options over the stored launch options", () => {
    const command = {
      kind: "docker-connect",
      target: "octo-dev",
      config: "./stored.json5",
    } as const;

    expect(
      replaceOctoFlags(command, {
        config: "./override.json5",
        unchained: true,
      }),
    ).toEqual({
      kind: "docker-connect",
      target: "octo-dev",
      config: "./override.json5",
      unchained: true,
    });
  });

  it("preserves stored launch options that are not overridden on resume", () => {
    const command = {
      kind: "docker-run" as const,
      dockerRunArgs: ["--rm", "alpine"],
      config: "./stored.json5",
      unchained: true,
    };

    expect(replaceOctoFlags(command, {})).toEqual(command);
  });

  it("fully replaces stored Docker run arguments on resume", () => {
    const command = {
      kind: "docker-run" as const,
      dockerRunArgs: ["--rm", "-w", "/repo", "old-image"],
      config: "./stored.json5",
    };

    expect(
      replaceDockerRunArgs(command, [
        "--rm",
        "-v",
        "/host/repo:/new-repo",
        "-w",
        "/new-repo",
        "new-image",
      ]),
    ).toEqual({
      kind: "docker-run",
      dockerRunArgs: ["--rm", "-v", "/host/repo:/new-repo", "-w", "/new-repo", "new-image"],
      config: "./stored.json5",
    });
  });

  it("rejects malformed or unsupported launch arguments", () => {
    expect(parseLaunchCommandArgs(["--config"]).kind).toBe("invalid");
    expect(parseLaunchCommandArgs(["docker", "connect"]).kind).toBe("invalid");
    expect(parseLaunchCommandArgs(["unknown"]).kind).toBe("invalid");
  });

  it("round trips ParsedCliArgs through v2 JSON", () => {
    const cliArgs = {
      kind: "docker-connect" as const,
      target: "octo-dev",
      config: "./octofriend.json5",
      unchained: true,
    };

    const json = serializeCliArgs(cliArgs);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(CLI_ARGS_JSON_VERSION);
    expect(parsed.kind).toBe("docker-connect");
    expect(parsed.target).toBe("octo-dev");

    expect(deserializeCliArgs(json)).toEqual(cliArgs);
  });
});
