import { describe, expect, it } from "bun:test";
import rewriteToolFactory from "./rewrite.ts";
import { fileTracker } from "../file-tracker.ts";
import { err } from "../../libocto/result.ts";
import { MockTransport } from "../../transports/mock.ts";
import { AbortError } from "../../transports/transport-common.ts";

const config = { yourName: "Test", models: [] };

async function createRewriteTool(transport: MockTransport) {
  const tool = await rewriteToolFactory({
    signal: new AbortController().signal,
    transport,
    data: config,
  });
  if (tool == null) throw new Error("rewrite tool did not load");
  return tool;
}

function rewriteToolCall(filePath: string) {
  const args = { filePath, text: "new contents" };
  return {
    toolCallId: "rewrite-call",
    original: { name: "rewrite" as const, arguments: args },
    parsed: {
      name: "rewrite" as const,
      arguments: { ...args, originalFileContents: "old contents" },
    },
  };
}

describe("rewrite tool", () => {
  it.each([
    { stage: "resolvePath", code: "ENOENT" },
    { stage: "mkdir", code: "EACCES" },
    { stage: "writeFile", code: "EROFS" },
    { stage: "writeFile", code: "ENOSPC" },
    { stage: "modTime", code: "EIO" },
  ] as const)("returns a tool error when $stage fails with $code", async ({ stage, code }) => {
    const signal = new AbortController().signal;
    const filePath = `rewrite-${stage}-${code}.txt`;
    const transport = new MockTransport({ files: { [filePath]: "old contents" } });
    const tool = await createRewriteTool(transport);
    await fileTracker.read(transport, signal, filePath);
    const modTime = transport.modTime.bind(transport);
    transport[stage] = async () => {
      throw Object.assign(new Error(`${code}: filesystem operation failed`), { code });
    };

    const result = await tool.run({
      signal,
      transport,
      toolCall: rewriteToolCall(filePath),
      data: config,
    });
    expect(result).toEqual(err(`Failed to rewrite file ${filePath}`));
    expect(await transport.readFile(signal, filePath)).toBe(
      stage === "modTime" ? "new contents" : "old contents",
    );
    if (stage === "modTime") {
      transport.modTime = modTime;
      expect(await fileTracker.isOutdated(transport, signal, filePath)).toBe(true);
    }
  });

  it("returns a tool error when an in-flight write is cancelled", async () => {
    const controller = new AbortController();
    const transport = new MockTransport({ files: { "cancel-rewrite.txt": "old contents" } });
    const tool = await createRewriteTool(transport);
    let entered!: () => void;
    const writing = new Promise<void>(resolve => {
      entered = resolve;
    });
    transport.writeFile = async signal => {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AbortError()), { once: true });
        entered();
      });
    };
    const result = tool.run({
      signal: controller.signal,
      transport,
      toolCall: rewriteToolCall("cancel-rewrite.txt"),
      data: config,
    });
    await writing;
    controller.abort();
    await expect(result).resolves.toEqual(err("Failed to rewrite file cancel-rewrite.txt"));
    expect(await transport.readFile(new AbortController().signal, "cancel-rewrite.txt")).toBe(
      "old contents",
    );
  });

  it("records a successful rewrite and updates its tracked timestamp", async () => {
    const signal = new AbortController().signal;
    const transport = new MockTransport({ files: { "rewrite-success.txt": "old contents" } });
    const tool = await createRewriteTool(transport);
    await fileTracker.read(transport, signal, "rewrite-success.txt");
    const result = await tool.run({
      signal,
      transport,
      toolCall: rewriteToolCall("rewrite-success.txt"),
      data: config,
    });
    expect(result).toMatchObject({
      success: true,
      data: { type: "custom-ir", data: { role: "file-mutate", path: "rewrite-success.txt" } },
    });
    expect(await transport.readFile(signal, "rewrite-success.txt")).toBe("new contents");
    expect(await fileTracker.isOutdated(transport, signal, "rewrite-success.txt")).toBe(false);
  });
});
