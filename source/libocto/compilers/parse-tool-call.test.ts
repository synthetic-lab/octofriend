import { describe, expect, it, jest, mock } from "bun:test";
import { t } from "structural";
import { ok } from "../result.ts";
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
    run: async () =>
      ok({
        type: "output" as const,
        content: [{ type: "text" as const, content: "" }],
      }),
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
      autofixJson: mock(),
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
      autofixJson: mock(async () => ({ success: true, fixed: { query: "fixed" } })),
      abortSignal: new AbortController().signal,
      transport: {} as any,
    });

    expect(parsed.status).toBe("success");
    if (parsed.status === "success") {
      expect(parsed.tool.original).toEqual({ query: "fixed" });
    }
  });

  it("reports invalid JSON when no autofix function is provided", async () => {
    const parsed = await parseToolCall({
      toolCall: {
        toolCallId: "call-1",
        toolName: "search",
        args: "{query:",
      },
      toolDefs: { search: searchTool() },
      abortSignal: new AbortController().signal,
      transport: {} as any,
    });

    expect(parsed).toEqual({
      status: "error",
      message: "Syntax error: invalid JSON in tool call arguments",
    });
  });

  it("reports unknown tools before parsing arguments", async () => {
    const parsed = await parseToolCall({
      toolCall: {
        toolCallId: "call-1",
        toolName: "missing",
        args: "{not json",
      },
      toolDefs: { search: searchTool() },
      autofixJson: mock(),
      abortSignal: new AbortController().signal,
      transport: {} as any,
    });

    expect(parsed.status).toBe("error");
    if (parsed.status === "error") {
      expect(parsed.message).toContain("Unknown tool missing");
    }
  });

  it("reports parser exceptions through an injected logger", async () => {
    const thrown = new Error("parser exploded");
    const toolCall = {
      toolCallId: "call-1",
      toolName: "search",
      args: JSON.stringify({ query: "needle" }),
    };
    const logger = { log: mock(), error: mock() };

    const parsed = await parseToolCall({
      toolCall,
      toolDefs: {
        search: {
          ...searchTool(),
          parse: async () => {
            throw thrown;
          },
        },
      },
      abortSignal: new AbortController().signal,
      transport: {} as any,
      logger,
    });

    expect(parsed.status).toBe("error");
    expect(logger.error.mock.calls).toEqual([[thrown], [toolCall]]);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("defaults parser exception logging to console.error", async () => {
    const thrown = new Error("parser exploded");
    const toolCall = {
      toolCallId: "call-1",
      toolName: "search",
      args: JSON.stringify({ query: "needle" }),
    };
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const parsed = await parseToolCall({
        toolCall,
        toolDefs: {
          search: {
            ...searchTool(),
            parse: async () => {
              throw thrown;
            },
          },
        },
        abortSignal: new AbortController().signal,
        transport: {} as any,
      });

      expect(parsed.status).toBe("error");
      expect(stderr.mock.calls).toEqual([[thrown], [toolCall]]);
    } finally {
      stderr.mockRestore();
    }
  });
});
