import { describe, expect, it } from "vitest";
import { serializeCliArgs, type ParsedCliArgs } from "./cli-args.ts";
import { serializeLlmIr } from "./llm-ir-json.ts";

const SHAPE_CHANGE_MESSAGE =
  "Serialized JSON changed. Bump its version and provide a migration before updating this expected shape.";

describe("versioned session JSON", () => {
  it("serializes octo-cli-args/v1 with its expected shape", () => {
    const cliArgs: ParsedCliArgs = {
      kind: "docker-run",
      dockerRunArgs: ["--rm", "alpine"],
      config: "./octofriend.json5",
      unchained: true,
    };

    expect(JSON.parse(serializeCliArgs(cliArgs)), SHAPE_CHANGE_MESSAGE).toEqual({
      version: "octo-cli-args/v1",
      ...cliArgs,
    });
  });

  it("serializes octo-llm-ir/v1 with its expected shape", () => {
    const ir = {
      role: "user" as const,
      content: [{ type: "text" as const, content: "hello" }],
    };

    expect(JSON.parse(serializeLlmIr(ir)), SHAPE_CHANGE_MESSAGE).toEqual({
      version: "octo-llm-ir/v1",
      ir,
    });
  });
});
