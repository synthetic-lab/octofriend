import { describe, expect, it } from "bun:test";
import { t } from "structural";
import { ToolBuilder, type ToolCallFromToolMap } from "./tool-def.ts";
import { fileReadIR } from "./file-ir.ts";
import { ok } from "../result.ts";
import type { ImageInfo } from "../images.ts";
import type { MultimodalConfig } from "../modalities.ts";
import { agent as agentBuilder, type TreeIR } from "../llm-ir.ts";
import { downconvert, lowerMessages } from "../ir-operations.ts";
import { prompt } from "../system-prompt.ts";
import read from "./read/index.ts";
import rewrite from "./rewrite/index.ts";

const agent = agentBuilder.definePermissionless({
  systemPrompt: prompt.declare(async () => "Test prompt"),
  tools: { read, rewrite },
  agents: {},
});

type FileToolCallRequest = ToolCallFromToolMap<typeof agent.tools>;

function convertFiles(messages: Array<TreeIR<typeof agent>>, modalities: MultimodalConfig | null) {
  return downconvert<typeof agent>(lowerMessages, modalities)(messages);
}

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

describe("automatic file IR lowering", () => {
  it("keeps the newest read for a path and strips older reads", () => {
    const messages: Array<TreeIR<typeof agent>> = [
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

    const pairs = convertFiles(messages, null);
    expect(pairs[0].original).toBe(messages[0]);
    expect(pairs[1].original).toBe(messages[1]);
    expect(pairs.map(({ converted }) => converted)).toEqual([
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

  it("answers displayable image reads with a tool output containing the image", () => {
    const image: ImageInfo = {
      mimeType: "image/png",
      base64Data: "abc",
      dataUrl: "data:image/png;base64,abc",
      filePath: "/tmp/a.png",
      sizeBytes: 3,
    };

    expect(
      convertFiles(
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
      ).map(({ converted }) => converted),
    ).toEqual([
      {
        role: "tool-output",
        toolCall: toolCall("image-read"),
        content: [
          { type: "text", content: "image contents" },
          { type: "image", image },
        ],
      },
    ]);
  });

  it("keeps read optimization local to contiguous runs and nested histories", () => {
    const _root = agentBuilder.definePermissionless({ ...agent, agents: { child: agent } });
    const before = fileReadIR(toolCall("before"))({ content: "before child" });
    const after = fileReadIR(toolCall("after"))({ content: "after child" });
    const oldChild = fileReadIR(toolCall("child-old"))({ content: "old child contents" });
    const newChild = fileReadIR(toolCall("child-new"))({ content: "new child contents" });
    const child: Extract<TreeIR<typeof _root>, { role: "subagent-trajectory" }> = {
      role: "subagent-trajectory",
      subagent: "child",
      task: [],
      toolCall: toolCall("delegate"),
      ir: [oldChild, newChild],
    };
    const convert = downconvert<typeof _root>(lowerMessages, null);
    const pairs = convert([before, child, after]);
    expect(pairs[0].converted).toMatchObject({
      content: [{ type: "text", content: "before child" }],
    });
    expect(pairs[2].converted).toMatchObject({
      content: [{ type: "text", content: "after child" }],
    });
    const nested = pairs[1].converted;
    if (nested.role !== "subagent-trajectory") throw new Error("Expected child trajectory");
    expect(nested.ir.map(pair => pair.converted)).toMatchObject([
      { role: "tool-output", content: [{ type: "text", content: "File was successfully read." }] },
      { role: "tool-output", content: [{ type: "text", content: "new child contents" }] },
    ]);
    expect(pairs[1].original).toBe(child);
    expect(nested.ir[0].original).toBe(oldChild);
    expect(child.ir).toEqual([oldChild, newChild]);
    expect(oldChild.content).toBe("old child contents");
    expect(convert([before, child, after])).toEqual(pairs);
  });

  it("lowers file extras alongside a client's own extra IR", () => {
    const note = new ToolBuilder<{}>()
      .declare({ name: "note", description: "Notes", ArgumentsSchema: t.subtype({}) })
      .withCustomIR({
        result: toolCall => (args: { text: string }) => ({
          role: "note" as const,
          toolCall,
          text: args.text,
        }),
      })
      .define(async () => ({ run: async () => ok({ type: "output", content: [] }) }));
    const _mixed = agentBuilder.definePermissionless({ ...agent, tools: { ...agent.tools, note } });
    const noteCall: ToolCallFromToolMap<{ note: typeof note }> = {
      type: "tool-call",
      name: "note",
      toolCallId: "note",
      original: {},
      parsed: {},
    };
    const file = fileReadIR(toolCall("read"))({ content: "file contents" });
    const result = downconvert<typeof _mixed>(
      messages =>
        messages.map(original => ({
          original,
          converted:
            original.role === "note"
              ? {
                  role: "tool-output" as const,
                  toolCall: original.toolCall,
                  content: [{ type: "text" as const, content: original.text }],
                }
              : original,
        })),
      null,
    )([file, { role: "note", toolCall: noteCall, text: "client contents" }]);
    expect(result.map(pair => pair.converted)).toEqual([
      {
        role: "tool-output",
        toolCall: file.toolCall,
        content: [{ type: "text", content: "file contents" }],
      },
      {
        role: "tool-output",
        toolCall: noteCall,
        content: [{ type: "text", content: "client contents" }],
      },
    ]);
    expect(result[0].original).toBe(file);
  });

  it("preserves a client's explicit conversion of a file result", () => {
    const file = fileReadIR(toolCall("read"))({ content: "private contents" });
    const result = downconvert<typeof agent>(
      messages =>
        messages.map(original => ({
          original,
          converted:
            original.role === "file-read"
              ? {
                  role: "tool-skip-output" as const,
                  toolCall: original.toolCall,
                  reason: "Redacted by client",
                }
              : original,
        })),
      null,
    )([file]);
    expect(result).toEqual([
      {
        original: file,
        converted: {
          role: "tool-skip-output",
          toolCall: file.toolCall,
          reason: "Redacted by client",
        },
      },
    ]);
  });

  it("rewrites file mutation to a base tool message", () => {
    expect(
      convertFiles(
        [
          {
            role: "file-mutate",
            path: "/tmp/a.txt",
            content: "raw mutate output",
            toolCall: mutateToolCall("mutate"),
          },
        ],
        null,
      ).map(({ converted }) => converted),
    ).toEqual([
      {
        role: "tool-output",
        toolCall: mutateToolCall("mutate"),
        content: [{ type: "text", content: "/tmp/a.txt was updated successfully." }],
      },
    ]);
  });
});
