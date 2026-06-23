import { describe, expect, it } from "vitest";
import type { ToolCall } from "../libocto/tool-def.ts";
import type toolMap from "../tools/tool-defs/index.ts";
import { ImageInfo } from "../utils/image-utils.ts";
import { optimizeFiles } from "./optimize-files.ts";

type FileToolCallRequest = Extract<
  ToolCall<typeof toolMap>,
  { name: "read" | "edit" | "create" | "rewrite" }
>;

function toolCall(id: string): Extract<FileToolCallRequest, { name: "read" }> {
  return {
    type: "tool-call",
    toolCallId: id,
    name: "read",
    original: { filePath: "/tmp/a.txt" },
    parsed: { filePath: "/tmp/a.txt" },
  };
}

function mutateToolCall(id: string): Extract<FileToolCallRequest, { name: "rewrite" }> {
  return {
    type: "tool-call",
    toolCallId: id,
    name: "rewrite",
    original: { filePath: "/tmp/a.txt", text: "" },
    parsed: { filePath: "/tmp/a.txt", text: "", originalFileContents: "idk" },
  };
}

describe("optimizeFiles", () => {
  it("keeps the newest read for a path and strips older reads", () => {
    const messages: Parameters<typeof optimizeFiles>[0] = [
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
        content: [{ type: "text", content: "File was successfully read." }],
      },
      {
        role: "tool-output",
        toolCall: toolCall("new"),
        content: [{ type: "text", content: "new contents" }],
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
        content: [
          { type: "text", content: "[Tool result for call image-read]: image contents" },
          { type: "image", image },
        ],
      },
    ]);
  });

  it("rewrites file mutation to a base tool message", () => {
    expect(
      optimizeFiles([
        {
          role: "file-mutate",
          path: "/tmp/a.txt",
          content: "raw mutate output",
          toolCall: mutateToolCall("mutate"),
        },
      ]),
    ).toEqual([
      {
        role: "tool-output",
        toolCall: mutateToolCall("mutate"),
        content: [{ type: "text", content: "/tmp/a.txt was updated successfully." }],
      },
    ]);
  });
});
