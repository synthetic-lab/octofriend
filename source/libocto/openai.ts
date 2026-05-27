import type OpenAI from "openai";
import type { CompilerModalities } from "./compiler-interface.ts";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type JsonObject = { [key: string]: JsonValue };

export type OpenAICompilerModel = {
  client: OpenAI;
  model: string;
  modalities?: CompilerModalities;
  reasoningEffort?: "low" | "medium" | "high";
};

export type StandardOpenAICompilerModel = OpenAICompilerModel;
export type ResponsesOpenAICompilerModel = OpenAICompilerModel;

export function openAIStrictFunctionParameters(schema: JsonObject): JsonObject {
  const normalized = structuredClone(schema);

  delete normalized["$schema"];
  delete normalized["description"];
  delete normalized["title"];
  lowerToOpenAIStrictSchema(normalized);

  return normalized;
}

export function normalizeOpenAIStrictFunctionArguments(
  schema: JsonObject,
  args: JsonValue,
): JsonValue {
  const optionalPaths: Array<Array<string>> = [];
  collectOptionalPropertyPaths(schema, [], optionalPaths);
  return deleteNullOptionals(args, optionalPaths);
}

function lowerToOpenAIStrictSchema(schema: JsonValue): JsonValue {
  if (Array.isArray(schema)) {
    return schema.map(item => lowerToOpenAIStrictSchema(item));
  }

  if (schema == null || typeof schema !== "object") return schema;

  const node = schema;
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

function collectOptionalPropertyPaths(
  schema: JsonValue,
  path: Array<string>,
  optionalPaths: Array<Array<string>>,
): void {
  if (Array.isArray(schema)) {
    for (const item of schema) collectOptionalPropertyPaths(item, path, optionalPaths);
    return;
  }

  if (schema == null || typeof schema !== "object") return;

  const properties = objectRecord(schema["properties"]);
  if (properties) {
    const required = new Set(
      Array.isArray(schema["required"]) ? schema["required"].filter(isString) : [],
    );

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      const propertyPath = [...path, propertyName];
      if (!required.has(propertyName)) optionalPaths.push(propertyPath);
      collectOptionalPropertyPaths(propertySchema, propertyPath, optionalPaths);
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" || key === "required") continue;
    collectOptionalPropertyPaths(value, path, optionalPaths);
  }
}

function deleteNullOptionals(args: JsonValue, optionalPaths: Array<Array<string>>): JsonValue {
  if (args == null || typeof args !== "object" || Array.isArray(args)) return args;
  const normalized = structuredClone(args);

  for (const path of optionalPaths) deleteIfNullAtPath(normalized, path);

  return normalized;
}

function deleteIfNullAtPath(value: JsonValue, path: Array<string>): void {
  if (path.length === 0 || value == null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const node = value;
  const [key, ...rest] = path;
  if (rest.length === 0) {
    if (node[key] === null) delete node[key];
    return;
  }

  deleteIfNullAtPath(node[key], rest);
}

function addOpenAIStrictTypeHints(node: JsonObject): void {
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

function nullableSchema(schema: JsonValue): JsonValue {
  if (schema == null || typeof schema !== "object" || Array.isArray(schema)) {
    return { anyOf: [schema, { type: "null" }] };
  }

  const node = schema;
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

function isNullSchema(schema: JsonValue): boolean {
  return (
    schema != null &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    schema["type"] === "null"
  );
}

function objectRecord(value: JsonValue | undefined): JsonObject | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function isString(value: JsonValue): value is string {
  return typeof value === "string";
}
