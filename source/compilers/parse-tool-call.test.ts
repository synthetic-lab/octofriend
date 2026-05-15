import { describe, expect, it, vi } from "vitest";
import { t } from "structural";
import { ok, err } from "../result.ts";
import { toolOutput } from "../tools/common.ts";
import { parseToolCall } from "./parse-tool-call.ts";

const ArgumentsSchema = t.subtype({
  query: t.str,
});

function searchTool() {
  return {
    name: "search",
    description: "Searches",
    ArgumentsSchema,
    ParsedSchema: ArgumentsSchema,
    parse: async ({ original }: { original: { query: string } }) =>
      ok({ original, parsed: original }),
    validate: async () => ok(null),
    run: async () => toolOutput(""),
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
        type: "tool-call",
        name: "search",
        original: { query: "needle" },
        parsed: { query: "needle" },
        toolCallId: "call-1",
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
      expect(parsed.tool.original).toEqual({ query: "fixed" });
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
