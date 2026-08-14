import { describe, expect, it } from "bun:test";
import { toJSONSchema } from "structural";
import readToolFactory from "./read.ts";
import partialReadToolFactory from "./partial-read.ts";
import { fileTracker } from "../file-tracker.ts";
import { unwrap } from "../../libocto/result.ts";
import type { Transport } from "../../transports/transport-common.ts";

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
  if (!tool) throw new Error("read tool did not load");
  return tool;
}

async function createPartialReadTool(transport: Transport) {
  const tool = await partialReadToolFactory({
    signal: new AbortController().signal,
    transport,
    data: {} as never,
  });
  if (!tool) throw new Error("partial-read tool did not load");
  return tool;
}

function readToolCall(args: { filePath: string }) {
  return {
    toolCallId: "test-call",
    original: { name: "read" as const, arguments: args },
    parsed: { name: "read" as const, arguments: args },
  };
}

function partialReadToolCall(args: { filePath: string; offset: number; limit: number }) {
  return {
    toolCallId: "test-call",
    original: { name: "partial-read" as const, arguments: args },
    parsed: { name: "partial-read" as const, arguments: args },
  };
}

type ObjectJsonSchema = {
  properties?: Record<string, unknown>;
  required?: string[];
};

describe("read tool", () => {
  it("only exposes filePath in its arguments", async () => {
    const transport = createTransport({ "/repo/full.txt": "contents" });
    const tool = await createReadTool(transport);
    const schema = toJSONSchema("ignore", tool.ArgumentsSchema) as ObjectJsonSchema;

    expect(Object.keys(schema.properties ?? {})).toEqual(["filePath"]);
    expect(schema.required).toEqual(["filePath"]);
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
});

describe("partial-read tool", () => {
  it("requires filePath, offset, and limit", async () => {
    const transport = createTransport({ "/repo/notes.txt": "contents" });
    const tool = await createPartialReadTool(transport);
    const schema = toJSONSchema("ignore", tool.ArgumentsSchema) as ObjectJsonSchema;

    expect(Object.keys(schema.properties ?? {})).toEqual(["filePath", "offset", "limit"]);
    expect(schema.required).toEqual(["filePath", "offset", "limit"]);
    expect(() =>
      tool.ArgumentsSchema.slice({ filePath: "notes.txt", limit: 1 } as never),
    ).toThrow();
    expect(() =>
      tool.ArgumentsSchema.slice({ filePath: "notes.txt", offset: 1 } as never),
    ).toThrow();
  });

  it("returns the requested range as ordinary tool output", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/notes.txt": "one\ntwo\nthree\nfour\nfive",
    });
    const tool = await createPartialReadTool(transport);

    const result = unwrap(
      await tool.run({
        signal,
        transport,
        toolCall: partialReadToolCall({ filePath: "notes.txt", offset: 2, limit: 2 }),
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

  it("does not mark files outdated after only a partial read", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/partial-only.txt": "one\ntwo\nthree",
    });
    const tool = await createPartialReadTool(transport);

    unwrap(
      await tool.run({
        signal,
        transport,
        toolCall: partialReadToolCall({
          filePath: "partial-only.txt",
          offset: 1,
          limit: 1,
        }),
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
    const readTool = await createReadTool(transport);
    const partialReadTool = await createPartialReadTool(transport);

    unwrap(
      await readTool.run({
        signal,
        transport,
        toolCall: readToolCall({ filePath: "already-full.txt" }),
        data: {} as never,
      }),
    );

    const result = unwrap(
      await partialReadTool.run({
        signal,
        transport,
        toolCall: partialReadToolCall({ filePath: "already-full.txt", offset: 2, limit: 1 }),
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
