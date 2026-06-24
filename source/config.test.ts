import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { readAuthForModel, readConfig } from "./config.ts";

const ENV_NAME = "OCTO_TEST_AUTH";
let previousEnvValue: string | undefined;

describe("readAuthForModel", () => {
  beforeEach(() => {
    previousEnvValue = process.env[ENV_NAME];
    delete process.env[ENV_NAME];
  });

  afterEach(() => {
    if (previousEnvValue == null) delete process.env[ENV_NAME];
    else process.env[ENV_NAME] = previousEnvValue;
  });

  it("returns an auth error for configured env auth when the variable is missing", async () => {
    await expect(
      readAuthForModel(
        {
          type: "standard",
          baseUrl: "https://example.test/v1",
          auth: { type: "env", name: ENV_NAME },
        },
        null,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        type: "missing",
        message: `Environment variable ${ENV_NAME} is not set`,
      },
    });
  });

  it("returns an auth error for legacy apiEnvVar auth when the variable is missing", async () => {
    await expect(
      readAuthForModel(
        {
          type: "standard",
          baseUrl: "https://example.test/v1",
          apiEnvVar: ENV_NAME,
        },
        null,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        type: "missing",
        message: `Environment variable ${ENV_NAME} is not set`,
      },
    });
  });

  it("rejects API-key auth on Codex models", async () => {
    const configPath = await writeConfigFixture({
      configVersion: 2,
      yourName: "test",
      models: [
        {
          type: "codex",
          nickname: "codex",
          model: "gpt-5.5",
          context: 200_000,
          auth: { type: "command", command: ["echo", "token"] },
        },
      ],
    });

    await expect(readConfig(configPath)).rejects.toThrow();
  });

  it("rejects Codex auth on API-key models", async () => {
    const configPath = await writeConfigFixture({
      configVersion: 2,
      yourName: "test",
      models: [
        {
          type: "standard",
          nickname: "api",
          baseUrl: "https://example.test/v1",
          model: "test-model",
          context: 10_000,
          auth: { type: "codex" },
        },
      ],
    });

    await expect(readConfig(configPath)).rejects.toThrow();
  });
});

async function writeConfigFixture(config: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-config-test-"));
  const configPath = path.join(dir, "config.json5");
  await fs.writeFile(configPath, JSON.stringify(config));
  return configPath;
}
