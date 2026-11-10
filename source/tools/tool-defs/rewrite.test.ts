import { describe, expect, it } from "bun:test";
import rewriteToolFactory from "./rewrite.ts";
import { fileTracker } from "../file-tracker.ts";
import { err, ok, unwrap } from "../../libocto/result.ts";
import { MockTransport } from "../../transports/mock.ts";

const config = {};
const model = { contextWindow: 100_000 };

async function createRewriteTool(transport: MockTransport) {
  const tool = await rewriteToolFactory({
    signal: new AbortController().signal,
    transport,
    model,
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
    unwrap(await fileTracker.read(transport, signal, filePath));
    const modTime = transport.modTime.bind(transport);
    if (stage === "resolvePath") {
      transport.resolvePath = async () =>
        err(`Could not resolve path ${filePath}: ${code}: filesystem operation failed`);
    } else {
      transport[stage] = async () => err(`${code}: filesystem operation failed`);
    }

    const result = await tool.run({
      signal,
      transport,
      model,
      toolCall: rewriteToolCall(filePath),
      data: config,
    });
    expect(result).toEqual(
      stage === "resolvePath"
        ? err(`Could not resolve path ${filePath}: ${code}: filesystem operation failed`)
        : err(`${code}: filesystem operation failed`),
    );
    expect(await transport.readFile(signal, filePath)).toEqual(
      ok(stage === "modTime" ? "new contents" : "old contents"),
    );
    if (stage === "modTime") {
      transport.modTime = modTime;
      expect(await fileTracker.isOutdated(transport, signal, filePath)).toEqual(ok(true));
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
      return new Promise(resolve => {
        signal.addEventListener(
          "abort",
          () => resolve(err("Could not write file cancel-rewrite.txt: Aborted")),
          { once: true },
        );
        entered();
      });
    };
    const result = tool.run({
      signal: controller.signal,
      transport,
      model,
      toolCall: rewriteToolCall("cancel-rewrite.txt"),
      data: config,
    });
    await writing;
    controller.abort();
    await expect(result).resolves.toEqual(err("Could not write file cancel-rewrite.txt: Aborted"));
    expect(await transport.readFile(new AbortController().signal, "cancel-rewrite.txt")).toEqual(
      ok("old contents"),
    );
  });

  it("records a successful rewrite and updates its tracked timestamp", async () => {
    const signal = new AbortController().signal;
    const transport = new MockTransport({ files: { "rewrite-success.txt": "old contents" } });
    const tool = await createRewriteTool(transport);
    unwrap(await fileTracker.read(transport, signal, "rewrite-success.txt"));
    const result = await tool.run({
      signal,
      transport,
      model,
      toolCall: rewriteToolCall("rewrite-success.txt"),
      data: config,
    });
    expect(result).toMatchObject({
      success: true,
      data: { type: "custom-ir", data: { role: "file-mutate", path: "rewrite-success.txt" } },
    });
    expect(await transport.readFile(signal, "rewrite-success.txt")).toEqual(ok("new contents"));
    expect(await fileTracker.isOutdated(transport, signal, "rewrite-success.txt")).toEqual(
      ok(false),
    );
  });
});
