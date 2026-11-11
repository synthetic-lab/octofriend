import { describe, expect, it } from "bun:test";
import { downconvert, lowerMessages, pendingToolCalls } from "../../ir-operations.ts";
import { definePermissionlessAgent, type TreeIR, type RecursiveLowered } from "../../llm-ir.ts";
import { compilerUsage } from "../../compilers/compiler-interface.ts";
import type { ToolCall } from "../tool-def.ts";
import type { ImageInfo } from "../../images.ts";
import type { MultimodalConfig } from "../../modalities.ts";
import { prompt } from "../../system-prompt.ts";
import read from "./index.ts";

const _agent = definePermissionlessAgent({
  systemPrompt: prompt.declare(async () => "Test prompt"),
  tools: { read },
  agents: {},
});

/*
 * Regression tests for BUGS.md #3: reading an image with a vision model must not leave a
 * dangling tool call in the lowered history.
 *
 * Every tool call in an assistant message must be answered by a tool-output-shaped IR before the
 * history is sent to a compiler. Anthropic hard-400s on unanswered `tool_use` blocks, and while
 * the chat-completions spec tolerates missing outputs, a call with no result is confusing and
 * out-of-distribution for models.
 */

type ReadToolCall = ToolCall<typeof _agent.tools>;

function readCall(id: string, filePath: string): ReadToolCall {
  return {
    type: "tool-call",
    name: "read",
    toolCallId: id,
    original: { filePath },
    parsed: { filePath },
  };
}

function imageInfo(): ImageInfo {
  return {
    mimeType: "image/png",
    base64Data: "aGVsbG8=",
    dataUrl: "data:image/png;base64,aGVsbG8=",
    filePath: "/tmp/screenshot.png",
    sizeBytes: 5,
  };
}

const VISION: MultimodalConfig = {
  image: {
    enabled: true,
    maxSizeMB: 10,
    acceptedMimeTypes: ["image/png"],
  },
};

function unansweredToolCallIds(messages: Array<RecursiveLowered<typeof _agent>>): string[] {
  const requested: string[] = [];
  const answered = new Set<string>();
  for (const { converted } of messages) {
    if (converted.role === "assistant") {
      for (const call of converted.toolCalls ?? []) {
        requested.push(call.toolCallId);
      }
      continue;
    }
    if (
      converted.role === "tool-output" ||
      converted.role === "tool-skip-output" ||
      converted.role === "tool-runtime-error" ||
      converted.role === "tool-validation-error"
    ) {
      answered.add(converted.toolCall.toolCallId);
      continue;
    }
    if (converted.role === "tool-parse-error") {
      answered.add(converted.malformedRequest.toolCallId);
    }
  }
  return requested.filter(id => !answered.has(id));
}

function imageReadHistory(): Array<TreeIR<typeof _agent>> {
  const call = readCall("call_image", "/tmp/screenshot.png");
  return [
    {
      role: "user",
      content: [{ type: "text", content: "What does /tmp/screenshot.png show?" }],
    },
    {
      role: "assistant",
      content: "Let me look at that image.",
      usage: compilerUsage(0, 0),
      toolCalls: [call],
    },
    {
      role: "file-read",
      path: "/tmp/screenshot.png",
      content: "Image file: /tmp/screenshot.png",
      image: imageInfo(),
      toolCall: call,
    },
  ];
}

describe("automatic read tool-call answering", () => {
  it("answers the tool call for an image read when the model has vision", () => {
    const lowered = downconvert<typeof _agent>(lowerMessages, VISION)(imageReadHistory());
    expect(unansweredToolCallIds(lowered)).toEqual([]);
  });

  it("answers the tool call for an image read when the model lacks vision", () => {
    const lowered = downconvert<typeof _agent>(lowerMessages, null)(imageReadHistory());
    expect(unansweredToolCallIds(lowered)).toEqual([]);
  });

  const unsupportedImages: Array<{
    name: string;
    modalities: MultimodalConfig | null;
    reason: string;
  }> = [
    { name: "no vision", modalities: null, reason: "does not support image viewing" },
    {
      name: "disabled vision",
      modalities: { image: { enabled: false, maxSizeMB: 10, acceptedMimeTypes: ["image/png"] } },
      reason: "does not support image viewing",
    },
    {
      name: "unsupported MIME type",
      modalities: { image: { enabled: true, maxSizeMB: 10, acceptedMimeTypes: ["image/jpeg"] } },
      reason: "does not support image/png",
    },
    {
      name: "oversized image",
      modalities: { image: { enabled: true, maxSizeMB: 0, acceptedMimeTypes: ["image/png"] } },
      reason: "too large",
    },
  ];
  it.each(unsupportedImages)(
    "omits images with $name without leaving pending calls",
    ({ modalities, reason }) => {
      const history = imageReadHistory();
      const pairs = downconvert<typeof _agent>(lowerMessages, modalities)(history);
      const result = pairs[2].converted;
      if (result.role !== "tool-output") throw new Error("Expected tool output");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: "text", content: expect.stringContaining(reason) });
      expect(unansweredToolCallIds(pairs)).toEqual([]);
      expect(pendingToolCalls(pairs)).toEqual([]);
      expect(pairs[2].original).toBe(history[2]);
      expect(history[2]).toMatchObject({ role: "file-read", image: imageInfo() });
    },
  );

  it("answers the tool call for a plain text read", () => {
    const call = readCall("call_text", "/tmp/notes.txt");
    const lowered = downconvert<typeof _agent>(
      lowerMessages,
      VISION,
    )([
      {
        role: "user",
        content: [{ type: "text", content: "Read /tmp/notes.txt" }],
      },
      {
        role: "assistant",
        content: "Reading it.",
        usage: compilerUsage(0, 0),
        toolCalls: [call],
      },
      {
        role: "file-read",
        path: "/tmp/notes.txt",
        content: "1: hello",
        toolCall: call,
      },
    ]);
    expect(unansweredToolCallIds(lowered)).toEqual([]);
  });
});
