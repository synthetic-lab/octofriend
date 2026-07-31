import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withMock } from "antipattern";
import fs from "fs/promises";
import os from "os";
import path from "path";
import json5 from "json5";
import {
  configDeps,
  hasExistingAuthForBaseUrl,
  readAuthForModel,
  readConfig,
  CURRENT_CONFIG_VERSION,
  DEFAULT_RETRY_COUNT,
  DEFAULT_RETRY_INTERVAL_MS,
  type Config,
} from "./config.ts";

const ENV_NAME = "OCTO_TEST_AUTH";
const MISSING_ENV_NAME = "OCTO_TEST_MISSING_AUTH";
let previousEnvValue: string | undefined;
let previousMissingEnvValue: string | undefined;

describe("readAuthForModel", () => {
  beforeEach(() => {
    previousEnvValue = process.env[ENV_NAME];
    previousMissingEnvValue = process.env[MISSING_ENV_NAME];
    delete process.env[ENV_NAME];
    delete process.env[MISSING_ENV_NAME];
  });

  afterEach(() => {
    if (previousEnvValue == null) delete process.env[ENV_NAME];
    else process.env[ENV_NAME] = previousEnvValue;
    if (previousMissingEnvValue == null) delete process.env[MISSING_ENV_NAME];
    else process.env[MISSING_ENV_NAME] = previousMissingEnvValue;
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

  it("uses auth from a historical Synthetic URL for a model on the current URL", async () => {
    const currentBaseUrl = "https://api.synthetic.new/openai/v1";
    const historicalBaseUrl = "https://api.glhf.chat/v1";
    process.env[ENV_NAME] = "synthetic-test-key";
    const currentModel: Config["models"][number] = {
      nickname: "current Synthetic model",
      baseUrl: currentBaseUrl,
      model: "hf:test/model",
      context: 10_000,
    };
    const config: Config = {
      yourName: "test",
      models: [
        currentModel,
        {
          nickname: "historical Synthetic model",
          baseUrl: historicalBaseUrl,
          model: "hf:test/old-model",
          context: 10_000,
          auth: { type: "env", name: ENV_NAME },
        },
      ],
      defaultApiKeyOverrides: {
        synthetic: MISSING_ENV_NAME,
      },
    };

    await withMock(
      configDeps,
      "readKeys",
      async () => ({}),
      async () => {
        await expect(readAuthForModel(currentModel, config)).resolves.toEqual({
          ok: true,
          auth: { type: "apiKey", apiKey: "synthetic-test-key" },
        });
        await expect(hasExistingAuthForBaseUrl(currentBaseUrl, config)).resolves.toBe(true);
      },
    );
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

describe("config migrations", () => {
  const model = {
    nickname: "test model",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    context: 10_000,
  };

  it("writes the default retry config when upgrading from a version without it", async () => {
    const configPath = await writeConfigFixture({
      configVersion: 2,
      yourName: "test",
      models: [model],
    });

    const config = await readConfig(configPath);
    expect(config.retry).toEqual({
      retryCount: DEFAULT_RETRY_COUNT,
      retryIntervalMs: DEFAULT_RETRY_INTERVAL_MS,
    });

    const written = json5.parse(await fs.readFile(configPath, "utf8"));
    expect(written.retry).toEqual({
      retryCount: DEFAULT_RETRY_COUNT,
      retryIntervalMs: DEFAULT_RETRY_INTERVAL_MS,
    });
    expect(written.configVersion).toBe(CURRENT_CONFIG_VERSION);
  });

  it("preserves existing retry settings when upgrading", async () => {
    const configPath = await writeConfigFixture({
      configVersion: 2,
      yourName: "test",
      models: [model],
      retry: {
        retryCount: 3,
      },
    });

    const config = await readConfig(configPath);
    expect(config.retry).toEqual({
      retryCount: 3,
      retryIntervalMs: DEFAULT_RETRY_INTERVAL_MS,
    });

    const written = json5.parse(await fs.readFile(configPath, "utf8"));
    expect(written.retry).toEqual({
      retryCount: 3,
      retryIntervalMs: DEFAULT_RETRY_INTERVAL_MS,
    });
  });
});
