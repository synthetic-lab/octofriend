import type { OctoIR } from "../ir/octo-ir.ts";

export type LlmIr = {
  type: "llm-ir";
  ir: OctoIR;
};

export const CURRENT_LLM_IR_JSON_VERSION = "octo-llm-ir/v1" as const;

type VersionedLlmIrJson = {
  version: typeof CURRENT_LLM_IR_JSON_VERSION;
  ir: OctoIR;
};

export function serializeLlmIr(ir: OctoIR): string {
  return JSON.stringify({
    version: CURRENT_LLM_IR_JSON_VERSION,
    ir,
  } satisfies VersionedLlmIrJson);
}

export function deserializeLlmIr(json: string): OctoIR {
  const parsed = JSON.parse(json) as unknown;
  return migrateLlmIrJson(parsed);
}

function migrateLlmIrJson(value: unknown): OctoIR {
  if (isObject(value) && value["version"] === CURRENT_LLM_IR_JSON_VERSION) {
    return value["ir"] as OctoIR;
  }

  throw new Error("Unsupported LLM IR JSON version");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
