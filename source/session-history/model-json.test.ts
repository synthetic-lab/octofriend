import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import type { ApiKeyModelConfig, CodexModelConfig, ModelConfig } from "../config.ts";
import { NO_MODEL_RECORDED, serializeModelJson, tryDeserializeModelJson } from "./model-json.ts";

const MODEL_JSON_MIGRATION = path.join(
  import.meta.dirname,
  "../../drizzle/0006_history_item_model_json.sql",
);

/*
 * Fails to compile if ModelConfigSchema gains a new variant beyond the API-key and Codex ones:
 * add an AllRequired fixture and serialization assertion for the new variant below, and bump
 * CURRENT_MODEL_JSON_VERSION in model-json.ts with a migration in migrateModelJson.
 */
export const modelConfigVariantCoverage: ModelConfig extends ApiKeyModelConfig | CodexModelConfig
  ? true
  : never = true;

/*
 * These fixtures are typed with AllRequired, which strips optionality from every field. If the
 * ModelConfig shape changes, this file fails to typecheck and the assertions below go stale.
 * When that happens, bump CURRENT_MODEL_JSON_VERSION in model-json.ts and add a migration to
 * migrateModelJson so models persisted by older sessions still resolve.
 */
type AllRequired<T> = { [K in keyof T]-?: T[K] };

const FULL_API_KEY_MODEL: AllRequired<ApiKeyModelConfig> = {
  type: "standard",
  nickname: "full-api-key-model",
  model: "full-model",
  context: 128_000,
  reasoning: "high",
  modalities: {
    image: {
      enabled: true,
      maxSizeMB: 5,
      acceptedMimeTypes: ["image/png"],
    },
  },
  baseUrl: "https://example.test/v1",
  apiEnvVar: "EXAMPLE_API_KEY",
  auth: { type: "env", name: "EXAMPLE_API_KEY" },
};

const FULL_CODEX_MODEL: AllRequired<CodexModelConfig> = {
  type: "codex",
  nickname: "full-codex-model",
  model: "gpt-5.5",
  context: 200_000,
  reasoning: "medium",
  modalities: {
    image: {
      enabled: true,
      maxSizeMB: 5,
      acceptedMimeTypes: ["image/png"],
    },
  },
  auth: { type: "codex" },
};

describe("model JSON versioning", () => {
  it("serializes the full API-key model shape under the current version", () => {
    // The version is intentionally hard-coded: bumping CURRENT_MODEL_JSON_VERSION without
    // updating the serialized shape (or vice versa) fails this test.
    expect(JSON.parse(serializeModelJson(FULL_API_KEY_MODEL))).toEqual({
      version: "octo-model/v1",
      model: FULL_API_KEY_MODEL,
    });
  });

  it("serializes the full Codex model shape under the current version", () => {
    expect(JSON.parse(serializeModelJson(FULL_CODEX_MODEL))).toEqual({
      version: "octo-model/v1",
      model: FULL_CODEX_MODEL,
    });
  });

  it("never confuses the no-model-recorded sentinel for a real model JSON", () => {
    // The migration uses this sentinel to backfill rows written before models were recorded; it
    // must never be valid model JSON.
    expect(() => JSON.parse(NO_MODEL_RECORDED)).toThrow();
    expect(tryDeserializeModelJson(NO_MODEL_RECORDED)).toBeNull();
  });

  it("uses the same sentinel in the backfill migration", () => {
    // The migration is a static SQL file, so the sentinel is duplicated there; this keeps the two
    // copies from drifting.
    const sql = readFileSync(MODEL_JSON_MIGRATION, "utf8");
    expect(sql).toContain(`'${NO_MODEL_RECORDED}'`);
  });
});
