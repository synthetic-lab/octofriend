import { describe, expect, it } from "vitest";
import { lowerOcto } from "./lower-octo.ts";
import type { LoweredIR } from "../libocto/llm-ir.ts";
import { compilerUsage } from "../libocto/compilers/compiler-interface.ts";
import type { ToolCall } from "../libocto/tool-def.ts";
import type toolMap from "../tools/tool-defs/index.ts";
import type { OctoIR } from "../ir/octo-ir.ts";
import type { ImageInfo } from "../utils/image-utils.ts";
import type { MultimodalConfig } from "../providers.ts";

/*
 * Regression tests for BUGS.md #3: reading an image with a vision model must not leave a
 * dangling tool call in the lowered history.
 *
 * Every tool call in an assistant message must be answered by a tool-output-shaped IR before the
 * history is sent to a compiler. Anthropic hard-400s on unanswered `tool_use` blocks, and while
 * the chat-completions spec tolerates missing outputs, a call with no result is confusing and
 * out-of-distribution for models.
 */

type ReadToolCall = Extract<ToolCall<typeof toolMap>, { name: "read" }>;

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

function unansweredToolCallIds(messages: Array<LoweredIR<typeof toolMap>>): string[] {
  const requested: string[] = [];
  const answered = new Set<string>();
  for (const ir of messages) {
    if (ir.role === "assistant") {
      for (const call of ir.toolCalls ?? []) {
        requested.push(call.toolCallId);
      }
      continue;
    }
    if (
      ir.role === "tool-output" ||
      ir.role === "tool-skip-output" ||
      ir.role === "tool-runtime-error" ||
      ir.role === "tool-validation-error"
    ) {
      answered.add(ir.toolCall.toolCallId);
      continue;
    }
    if (ir.role === "tool-parse-error") {
      answered.add(ir.malformedRequest.toolCallId);
    }
  }
  return requested.filter(id => !answered.has(id));
}

function imageReadHistory(): OctoIR[] {
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

describe("lowerOcto tool-call answering", () => {
  it("answers the tool call for an image read when the model has vision", () => {
    const lowered = lowerOcto(imageReadHistory(), VISION);
    expect(unansweredToolCallIds(lowered)).toEqual([]);
  });

  it("answers the tool call for an image read when the model lacks vision", () => {
    const lowered = lowerOcto(imageReadHistory(), undefined);
    expect(unansweredToolCallIds(lowered)).toEqual([]);
  });

  it("answers the tool call for a plain text read", () => {
    const call = readCall("call_text", "/tmp/notes.txt");
    const lowered = lowerOcto(
      [
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
      ],
      VISION,
    );
    expect(unansweredToolCallIds(lowered)).toEqual([]);
  });
});
