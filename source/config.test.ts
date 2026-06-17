import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAuthForModel } from "./config.ts";

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
});
