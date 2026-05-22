import path from "path";
import { describe, expect, it } from "vitest";
import { HistoryItem, sequenceId } from "../history.ts";
import { ToolCallRequest } from "./llm-ir.ts";
import { toLlmIR } from "./convert-history-ir.ts";

function readToolCall(args: {
  filePath: string;
  offset?: number;
  limit?: number;
}): ToolCallRequest {
  return {
    type: "tool-request",
    toolCallId: `read-${sequenceId()}`,
    call: {
      original: { name: "read", arguments: args },
      parsed: { name: "read", arguments: args },
    },
  } as ToolCallRequest;
}

function readOutput(
  args: { filePath: string; offset?: number; limit?: number },
  content: string,
): HistoryItem {
  return {
    id: sequenceId(),
    type: "tool-output",
    result: { content },
    toolCall: readToolCall(args),
  };
}

describe("toLlmIR read output conversion", () => {
  it("keeps full reads as file-read IR", () => {
    const [ir] = toLlmIR([readOutput({ filePath: "notes.txt" }, "1: one")]);

    expect(ir).toMatchObject({
      role: "file-read",
      content: "1: one",
      path: path.resolve("notes.txt"),
    });
  });

  it("keeps partial reads out of file-read IR optimization", () => {
    const content = "Showing lines 2-2 of 3 from notes.txt\n2: two";
    const [ir] = toLlmIR([readOutput({ filePath: "notes.txt", offset: 2, limit: 1 }, content)]);

    expect(ir).toMatchObject({
      role: "tool-output",
      content,
    });
    expect(ir).not.toHaveProperty("path");
  });
});
