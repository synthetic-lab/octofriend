import { describe, expect, it } from "vitest";
import readToolFactory from "./read.ts";
import { fileTracker } from "../file-tracker.ts";
import type { Transport } from "../../transports/transport-common.ts";
import type { Result } from "../../libocto/result.ts";

function createTransport(files: Record<string, string>): Transport {
  const resolve = (file: string) => (file.startsWith("/") ? file : `/repo/${file}`);
  const modTimes = new Map(Object.keys(files).map((file, index) => [resolve(file), index + 1]));

  return {
    cwd: "/repo",
    async writeFile(_signal, file, contents) {
      const resolved = resolve(file);
      files[resolved] = contents;
      modTimes.set(resolved, (modTimes.get(resolved) ?? 0) + 1);
    },
    async readFile(_signal, file) {
      const content = files[resolve(file)];
      if (content == null) {
        throw new Error(`No such file: ${file}`);
      }
      return content;
    },
    async pathExists(_signal, file) {
      return files[resolve(file)] != null;
    },
    async isDirectory() {
      return false;
    },
    async mkdir() {},
    async readdir() {
      return [];
    },
    async modTime(_signal, file) {
      const modTime = modTimes.get(resolve(file));
      if (modTime == null) {
        throw new Error(`No such file: ${file}`);
      }
      return modTime;
    },
    async resolvePath(_signal, file) {
      return resolve(file);
    },
    async shell() {
      return "";
    },
    async close() {},
  };
}

async function createReadTool(transport: Transport) {
  const tool = await readToolFactory({
    signal: new AbortController().signal,
    transport,
    data: {} as never,
  });
  if (!tool) {
    throw new Error("read tool did not load");
  }
  return tool;
}

function unwrap<T>(result: Result<T, string>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
}

function readToolCall(args: { filePath: string; offset?: number; limit?: number }) {
  return {
    toolCallId: "test-call",
    original: { name: "read" as const, arguments: args },
    parsed: { name: "read" as const, arguments: args },
  };
}

describe("read tool", () => {
  it("returns partial reads as ordinary tool output", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/notes.txt": "one\ntwo\nthree\nfour\nfive",
    });
    const tool = await createReadTool(transport);

    const result = unwrap(
      await tool.run({
        signal,
        transport,
        toolCall: readToolCall({ filePath: "notes.txt", offset: 2, limit: 2 }),
        data: {} as never,
      }),
    );

    expect(result).toEqual({
      type: "output",
      content: [
        {
          type: "text",
          content: "Showing lines 2-3 of 5 from notes.txt\n2: two\n3: three",
        },
      ],
      lines: 5,
    });
  });

  it("returns full reads as file-read IR", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/full.txt": "one\ntwo\nthree",
    });
    const tool = await createReadTool(transport);
    const toolResult = await tool.run({
      signal,
      transport,
      toolCall: readToolCall({ filePath: "full.txt" }),
      data: {} as never,
    });

    const result = unwrap(toolResult);

    expect(result.type).toBe("custom-ir");
    if (result.type !== "custom-ir") return;
    expect(result.data).toMatchObject({
      role: "file-read",
      content: "1: one\n2: two\n3: three",
      path: "full.txt",
    });
  });

  it("does not mark files outdated after only a partial read", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/partial-only.txt": "one\ntwo\nthree",
    });
    const tool = await createReadTool(transport);

    unwrap(
      await tool.run({
        signal,
        transport,
        toolCall: readToolCall({ filePath: "partial-only.txt", offset: 1, limit: 1 }),
        data: {} as never,
      }),
    );

    await expect(fileTracker.isOutdated(transport, signal, "partial-only.txt")).resolves.toBe(
      false,
    );
  });

  it("keeps edit permission after a later partial read", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/already-full.txt": "one\ntwo\nthree",
    });
    const tool = await createReadTool(transport);

    unwrap(
      await tool.run({
        signal,
        transport,
        toolCall: readToolCall({ filePath: "already-full.txt" }),
        data: {} as never,
      }),
    );

    const result = unwrap(
      await tool.run({
        signal,
        transport,
        toolCall: readToolCall({ filePath: "already-full.txt", offset: 2, limit: 1 }),
        data: {} as never,
      }),
    );

    expect(result).toMatchObject({
      type: "output",
      content: [
        {
          type: "text",
          content: "Showing lines 2-2 of 3 from already-full.txt\n2: two",
        },
      ],
    });
    await expect(fileTracker.isOutdated(transport, signal, "already-full.txt")).resolves.toBe(
      false,
    );
  });
});
