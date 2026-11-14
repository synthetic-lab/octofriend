import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toJSONSchema } from "structural";
import readToolFactory from "./read.ts";
import partialReadToolFactory from "./partial-read.ts";
import { fileTracker } from "../file-tracker.ts";
import { err, ok, unwrap } from "../../libocto/result.ts";
import { MockTransport } from "../../transports/mock.ts";
import type { Transport } from "../../libocto/transport.ts";

function createTransport(files: Record<string, string>): Transport {
  return new MockTransport({ cwd: "/repo", files });
}

async function createReadTool(transport: Transport) {
  const tool = await readToolFactory({
    signal: new AbortController().signal,
    transport,
    model: { contextWindow: 100_000 },
    data: {},
  });
  if (!tool) throw new Error("read tool did not load");
  return tool;
}

async function createPartialReadTool(transport: Transport) {
  const tool = await partialReadToolFactory({
    signal: new AbortController().signal,
    transport,
    model: { contextWindow: 100_000 },
    data: {},
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
  it.each(["resolvePath", "readFile", "modTime"] as const)(
    "propagates a FileTracker error when %s fails",
    async stage => {
      const transport = new MockTransport({ files: { "read-error.txt": "contents" } });
      if (stage === "resolvePath") {
        transport.resolvePath = async () =>
          err("Could not resolve path read-error.txt: Filesystem failure");
      } else {
        transport[stage] = async () => err("Filesystem failure");
      }
      const tool = await createReadTool(transport);
      expect(
        await tool.run({
          signal: new AbortController().signal,
          transport,
          model: { contextWindow: 100_000 },
          toolCall: readToolCall({ filePath: "read-error.txt" }),
          data: {},
        }),
      ).toEqual(
        stage === "resolvePath"
          ? err("Could not resolve path read-error.txt: Filesystem failure")
          : err("Filesystem failure"),
      );
    },
  );

  it("propagates an image timestamp failure instead of reporting a successful read", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "octo-read-image-"));
    const filePath = path.join(directory, "image.png");
    try {
      await writeFile(
        filePath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const transport = new MockTransport({});
      transport.modTime = async () => err("Could not get modified time: EIO");
      const tool = await createReadTool(transport);
      expect(
        await tool.run({
          signal: new AbortController().signal,
          transport,
          model: { contextWindow: 100_000 },
          toolCall: readToolCall({ filePath }),
          data: {},
        }),
      ).toEqual(err("Could not get modified time: EIO"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
      model: { contextWindow: 100_000 },
      toolCall: readToolCall({ filePath: "full.txt" }),
      data: {},
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
  it.each(["resolvePath", "readFile"] as const)(
    "propagates a FileTracker error when %s fails",
    async stage => {
      const transport = new MockTransport({ files: { "partial-error.txt": "contents" } });
      if (stage === "resolvePath") {
        transport.resolvePath = async () =>
          err("Could not resolve path partial-error.txt: Filesystem failure");
      } else {
        transport[stage] = async () => err("Filesystem failure");
      }
      const tool = await createPartialReadTool(transport);
      expect(
        await tool.run({
          signal: new AbortController().signal,
          transport,
          model: { contextWindow: 100_000 },
          toolCall: partialReadToolCall({ filePath: "partial-error.txt", offset: 1, limit: 1 }),
          data: {},
        }),
      ).toEqual(
        stage === "resolvePath"
          ? err("Could not resolve path partial-error.txt: Filesystem failure")
          : err("Filesystem failure"),
      );
    },
  );

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
        model: { contextWindow: 100_000 },
        toolCall: partialReadToolCall({ filePath: "notes.txt", offset: 2, limit: 2 }),
        data: {},
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
        model: { contextWindow: 100_000 },
        data: {},
      }),
    );

    await expect(fileTracker.isOutdated(transport, signal, "partial-only.txt")).resolves.toEqual(
      ok(false),
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
        model: { contextWindow: 100_000 },
        toolCall: readToolCall({ filePath: "already-full.txt" }),
        data: {},
      }),
    );

    const result = unwrap(
      await partialReadTool.run({
        signal,
        transport,
        model: { contextWindow: 100_000 },
        toolCall: partialReadToolCall({ filePath: "already-full.txt", offset: 2, limit: 1 }),
        data: {},
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
    await expect(fileTracker.isOutdated(transport, signal, "already-full.txt")).resolves.toEqual(
      ok(false),
    );
  });
});
