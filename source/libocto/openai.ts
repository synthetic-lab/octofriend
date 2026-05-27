import type OpenAI from "openai";
import type { CompilerModalities } from "./compiler-interface.ts";

export type OpenAICompilerModel = {
  client: OpenAI;
  model: string;
  modalities?: CompilerModalities;
  reasoningEffort?: "low" | "medium" | "high";
};

export type StandardOpenAICompilerModel = OpenAICompilerModel;
export type ResponsesOpenAICompilerModel = OpenAICompilerModel;

export function openAIStrictFunctionParameters(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = structuredClone(schema);

  delete normalized["$schema"];
  delete normalized["description"];
  delete normalized["title"];
  lowerToOpenAIStrictSchema(normalized);

  return normalized;
}

function lowerToOpenAIStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(item => lowerToOpenAIStrictSchema(item));
  }

  if (schema == null || typeof schema !== "object") return schema;

  const node = schema as Record<string, unknown>;
  addOpenAIStrictTypeHints(node);
  const properties = objectRecord(node["properties"]);

  if (properties) {
    const required = new Set(
      Array.isArray(node["required"]) ? node["required"].filter(isString) : [],
    );
    const propertyNames = Object.keys(properties);

    for (const propertyName of propertyNames) {
      const loweredProperty = lowerToOpenAIStrictSchema(properties[propertyName]);
      properties[propertyName] = required.has(propertyName)
        ? loweredProperty
        : nullableSchema(loweredProperty);
    }

    node["required"] = propertyNames;
  }

  if (properties && node["additionalProperties"] === undefined) {
    node["additionalProperties"] = false;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "required") continue;
    node[key] = lowerToOpenAIStrictSchema(value);
  }

  return node;
}

function addOpenAIStrictTypeHints(node: Record<string, unknown>): void {
  if (node["type"] !== undefined) return;
  const enumValues = node["enum"];
  if (Array.isArray(enumValues)) {
    const nonNullValues = enumValues.filter(value => value !== null);
    if (nonNullValues.length > 0 && nonNullValues.every(value => typeof value === "string")) {
      node["type"] = enumValues.includes(null) ? ["string", "null"] : "string";
      return;
    }
  }

  const constValue = node["const"];
  if (typeof constValue === "string") node["type"] = "string";
}

function nullableSchema(schema: unknown): unknown {
  if (schema == null || typeof schema !== "object" || Array.isArray(schema)) {
    return { anyOf: [schema, { type: "null" }] };
  }

  const node = schema as Record<string, unknown>;
  const type = node["type"];
  if (type === "null") return node;
  if (typeof type === "string") return { ...node, type: [type, "null"] };
  if (Array.isArray(type)) {
    if (type.includes("null")) return node;
    return { ...node, type: [...type, "null"] };
  }

  const anyOf = node["anyOf"];
  if (Array.isArray(anyOf)) {
    if (anyOf.some(isNullSchema)) return node;
    return { ...node, anyOf: [...anyOf, { type: "null" }] };
  }

  return { anyOf: [node, { type: "null" }] };
}

function isNullSchema(schema: unknown): boolean {
  return (
    schema != null &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    (schema as Record<string, unknown>)["type"] === "null"
  );
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
