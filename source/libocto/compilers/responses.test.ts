import { describe, expect, it } from "vitest";
import {
  normalizeOpenAIStrictFunctionArguments,
  openAIStrictFunctionParameters,
} from "./responses.ts";

describe("openAIStrictFunctionParameters", () => {
  it("closes object schemas for OpenAI strict function calling", () => {
    const strict = openAIStrictFunctionParameters({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "ignore",
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
      },
    });

    expect(strict).toEqual({
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
      },
      additionalProperties: false,
    });
  });

  it("turns optional object properties into nullable required properties", () => {
    const schema = {
      type: "object",
      required: [],
      properties: {
        dirPath: { type: "string" },
      },
    };
    const strict = openAIStrictFunctionParameters(schema);

    expect(strict).toEqual({
      type: "object",
      required: ["dirPath"],
      properties: {
        dirPath: { type: ["string", "null"] },
      },
      additionalProperties: false,
    });
    expect(
      normalizeOpenAIStrictFunctionArguments(schema, {
        dirPath: null,
      }),
    ).toEqual({});
  });

  it("does not delete real non-null optional values", () => {
    const schema = {
      type: "object",
      required: [],
      properties: {
        dirPath: { type: "string" },
      },
    };

    expect(normalizeOpenAIStrictFunctionArguments(schema, { dirPath: "." })).toEqual({
      dirPath: ".",
    });
  });

  it("preserves dictionary schemas while lowering nested optional fields", () => {
    const strict = openAIStrictFunctionParameters({
      type: "object",
      required: [],
      properties: {
        args: {
          type: "object",
          properties: {},
          additionalProperties: { type: "string" },
        },
      },
    });

    expect(strict).toEqual({
      type: "object",
      required: ["args"],
      properties: {
        args: {
          type: ["object", "null"],
          properties: {},
          required: [],
          additionalProperties: { type: "string" },
        },
      },
      additionalProperties: false,
    });
  });

  it("adds type hints for string enums", () => {
    const strict = openAIStrictFunctionParameters({
      type: "object",
      required: ["skillName"],
      properties: {
        skillName: { enum: ["planner", "reviewer"] },
      },
    });

    expect(strict).toEqual({
      type: "object",
      required: ["skillName"],
      properties: {
        skillName: {
          type: "string",
          enum: ["planner", "reviewer"],
        },
      },
      additionalProperties: false,
    });
  });
});
