import { describe, expect, it } from "vitest";
import { openAIStrictFunctionParameters } from "./openai.ts";

describe("openAIStrictFunctionParameters", () => {
  it("closes object schemas for OpenAI strict function calling", () => {
    expect(
      openAIStrictFunctionParameters({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "ignore",
        type: "object",
        required: ["filePath"],
        properties: {
          filePath: { type: "string" },
        },
      }),
    ).toEqual({
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
      },
      additionalProperties: false,
    });
  });

  it("turns optional object properties into nullable required properties", () => {
    expect(
      openAIStrictFunctionParameters({
        type: "object",
        required: [],
        properties: {
          dirPath: { type: "string" },
        },
      }),
    ).toEqual({
      type: "object",
      required: ["dirPath"],
      properties: {
        dirPath: { type: ["string", "null"] },
      },
      additionalProperties: false,
    });
  });

  it("preserves dictionary schemas while lowering nested optional fields", () => {
    expect(
      openAIStrictFunctionParameters({
        type: "object",
        required: [],
        properties: {
          args: {
            type: "object",
            properties: {},
            additionalProperties: { type: "string" },
          },
        },
      }),
    ).toEqual({
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
    expect(
      openAIStrictFunctionParameters({
        type: "object",
        required: ["skillName"],
        properties: {
          skillName: { enum: ["planner", "reviewer"] },
        },
      }),
    ).toEqual({
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
