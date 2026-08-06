import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withMock } from "antipattern";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  configDeps,
  getModelFromConfig,
  hasExistingAuthForBaseUrl,
  matchModelFromConfig,
  readAuthForModel,
  readConfig,
  type Config,
  type ModelConfig,
} from "./config.ts";
import { serializeModelJson } from "./session-history/model-json.ts";

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

describe("matchModelFromConfig", () => {
  const smartModel: ModelConfig = {
    nickname: "smart-model",
    baseUrl: "https://example.test/v1",
    model: "smart",
    context: 128_000,
    auth: { type: "env", name: ENV_NAME },
  };
  const fastModel: ModelConfig = {
    nickname: "fast-model",
    baseUrl: "https://example.test/v1",
    model: "fast",
    context: 32_000,
  };
  const config: Config = {
    yourName: "test",
    models: [smartModel, fastModel],
  };

  it("returns the default model when there is no override", () => {
    expect(getModelFromConfig(config, null)).toBe(smartModel);
  });

  it("exactly matches an unchanged serialized model", () => {
    expect(matchModelFromConfig(config, serializeModelJson(fastModel))).toBe(fastModel);
  });

  it("fuzzy-matches on baseUrl, model, and auth when other fields changed", () => {
    const renamed: ModelConfig = {
      ...smartModel,
      nickname: "renamed-smart-model",
      context: 64_000,
      reasoning: "high",
    };
    expect(matchModelFromConfig(config, serializeModelJson(renamed))).toBe(smartModel);
  });

  it("treats legacy apiEnvVar as equivalent to env auth", () => {
    const legacy: ModelConfig = {
      nickname: "smart-model",
      baseUrl: "https://example.test/v1",
      model: "smart",
      context: 128_000,
      apiEnvVar: ENV_NAME,
    };
    expect(matchModelFromConfig(config, serializeModelJson(legacy))).toBe(smartModel);
  });

  it("loosely matches on baseUrl and model when auth fields differ", () => {
    const reauthed: ModelConfig = {
      ...smartModel,
      auth: { type: "env", name: MISSING_ENV_NAME },
    };
    expect(matchModelFromConfig(config, serializeModelJson(reauthed))).toBe(smartModel);
  });

  it("does not match when the base URL differs", () => {
    const moved: ModelConfig = {
      ...smartModel,
      baseUrl: "https://elsewhere.test/v1",
    };
    expect(matchModelFromConfig(config, serializeModelJson(moved))).toBeNull();
  });

  it("does not match when the model string differs", () => {
    const swapped: ModelConfig = {
      ...smartModel,
      model: "some-other-model",
    };
    expect(matchModelFromConfig(config, serializeModelJson(swapped))).toBeNull();
  });

  it("falls back to the default model when nothing matches", () => {
    const moved: ModelConfig = {
      ...smartModel,
      baseUrl: "https://elsewhere.test/v1",
    };
    expect(getModelFromConfig(config, serializeModelJson(moved))).toBe(smartModel);
  });

  it("returns null for an unparseable override", () => {
    expect(matchModelFromConfig(config, "not json")).toBeNull();
    expect(getModelFromConfig(config, "not json")).toBe(smartModel);
  });
});
