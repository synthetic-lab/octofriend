import { describe, expect, it } from "vitest";
import { LlmIR, ToolCallRequest } from "../ir/llm-ir.ts";
import { ImageInfo } from "../utils/image-utils.ts";
import { optimizeFiles } from "./optimize-files.ts";

function toolCall(id: string): ToolCallRequest {
  return {
    type: "tool-request",
    toolCallId: id,
    call: {
      original: {
        name: "read",
        arguments: {},
      },
    },
  } as ToolCallRequest;
}

describe("optimizeFiles", () => {
  it("keeps the newest read for a path and strips older reads", () => {
    const messages: LlmIR[] = [
      {
        role: "file-read",
        path: "/tmp/a.txt",
        content: "old contents",
        toolCall: toolCall("old"),
      },
      {
        role: "file-read",
        path: "/tmp/a.txt",
        content: "new contents",
        toolCall: toolCall("new"),
      },
    ];

    expect(optimizeFiles(messages)).toEqual([
      {
        role: "tool-output",
        toolCall: toolCall("old"),
        content: "File was successfully read.",
      },
      {
        role: "tool-output",
        toolCall: toolCall("new"),
        content: "new contents",
      },
    ]);
  });

  it("turns displayable image reads into user messages with images", () => {
    const image: ImageInfo = {
      mimeType: "image/png",
      base64Data: "abc",
      dataUrl: "data:image/png;base64,abc",
      filePath: "/tmp/a.png",
      sizeBytes: 3,
    };

    expect(
      optimizeFiles(
        [
          {
            role: "file-read",
            path: "/tmp/a.png",
            content: "image contents",
            image,
            toolCall: toolCall("image-read"),
          },
        ],
        {
          image: {
            enabled: true,
            acceptedMimeTypes: ["image/png"],
            maxSizeMB: 1,
          },
        },
      ),
    ).toEqual([
      {
        role: "user",
        content: "[Tool result for call image-read]: image contents",
        images: [image],
      },
    ]);
  });

  it("rewrites file mutation and file errors to base tool messages", () => {
    expect(
      optimizeFiles([
        {
          role: "file-mutate",
          path: "/tmp/a.txt",
          content: "raw mutate output",
          toolCall: toolCall("mutate"),
        },
        {
          role: "file-unreadable",
          path: "/tmp/b.txt",
          error: "could not read file",
          toolCall: toolCall("unreadable"),
        },
      ]),
    ).toEqual([
      {
        role: "tool-output",
        toolCall: toolCall("mutate"),
        content: "/tmp/a.txt was updated successfully.",
      },
      {
        role: "tool-error",
        toolCall: toolCall("unreadable"),
        error: "could not read file",
      },
    ]);
  });
});
