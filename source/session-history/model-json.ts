import type { ModelConfig } from "../config.ts";

export const CURRENT_MODEL_JSON_VERSION = "octo-model/v1" as const;

type VersionedModelJson = {
  version: typeof CURRENT_MODEL_JSON_VERSION;
  model: ModelConfig;
};

export function serializeModelJson(model: ModelConfig): string {
  return JSON.stringify({
    version: CURRENT_MODEL_JSON_VERSION,
    model,
  } satisfies VersionedModelJson);
}

export function deserializeModelJson(json: string): ModelConfig {
  const parsed = JSON.parse(json) as unknown;
  return migrateModelJson(parsed);
}

export function tryDeserializeModelJson(json: string): ModelConfig | null {
  try {
    return deserializeModelJson(json);
  } catch {
    return null;
  }
}

function migrateModelJson(value: unknown): ModelConfig {
  if (isObject(value) && value["version"] === CURRENT_MODEL_JSON_VERSION) {
    return value["model"] as ModelConfig;
  }

  throw new Error("Unsupported model JSON version");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
