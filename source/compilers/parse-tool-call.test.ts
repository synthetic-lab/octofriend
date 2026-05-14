import { describe, expect, it, vi } from "vitest";
import { t } from "structural";
import { result } from "../result.ts";
import { ToolDef } from "../tools/common.ts";
import { parseToolCall } from "./parse-tool-call.ts";

const ArgumentsSchema = t.subtype({
  query: t.str,
});

const Schema = t.subtype({
  name: t.value("search"),
  arguments: ArgumentsSchema,
});

function searchTool(): ToolDef<"search", { query: string }, { query: string }> {
  return {
    ArgumentsSchema,
    ParsedSchema: ArgumentsSchema,
    Schema,
    parse: async (_signal, _transport, original) => result.ok({ original, parsed: original }),
    validate: async () => null,
    run: async () => ({ content: "" }),
  };
}

describe("parseToolCall", () => {
  it("parses JSON arguments and validates them against the tool schema", async () => {
    const parsed = await parseToolCall({
      toolCall: {
        toolCallId: "call-1",
        toolName: "search",
        args: JSON.stringify({ query: "needle" }),
      },
      toolDefs: { search: searchTool() },
      autofixJson: vi.fn(),
      abortSignal: new AbortController().signal,
      transport: {} as any,
    });

    expect(parsed).toEqual({
      status: "success",
      tool: {
        type: "tool-request",
        toolCallId: "call-1",
        call: {
          original: {
            name: "search",
            arguments: { query: "needle" },
          },
          parsed: {
            name: "search",
            arguments: { query: "needle" },
          },
        },
      },
    });
  });

  it("uses autofixed JSON when raw arguments are invalid", async () => {
    const parsed = await parseToolCall({
      toolCall: {
        toolCallId: "call-1",
        toolName: "search",
        args: "{query:",
      },
      toolDefs: { search: searchTool() },
      autofixJson: vi.fn(async () => ({ success: true, fixed: { query: "fixed" } })),
      abortSignal: new AbortController().signal,
      transport: {} as any,
    });

    expect(parsed.status).toBe("success");
    if (parsed.status === "success") {
      expect(parsed.tool.call.original.arguments).toEqual({ query: "fixed" });
    }
  });

  it("reports unknown tools before parsing arguments", async () => {
    const parsed = await parseToolCall({
      toolCall: {
        toolCallId: "call-1",
        toolName: "missing",
        args: "{not json",
      },
      toolDefs: { search: searchTool() },
      autofixJson: vi.fn(),
      abortSignal: new AbortController().signal,
      transport: {} as any,
    });

    expect(parsed.status).toBe("error");
    if (parsed.status === "error") {
      expect(parsed.message).toContain("Unknown tool missing");
    }
  });
});
