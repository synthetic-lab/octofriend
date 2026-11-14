import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toJSONSchema } from "structural";
import readToolFactory from "./index.ts";
import { err, unwrap } from "../../result.ts";
import { MockTransport } from "../../../transports/mock.ts";
import type { Transport } from "../../transport.ts";

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

function readToolCall(args: { filePath: string }) {
  return {
    toolCallId: "test-call",
    original: { name: "read" as const, arguments: args },
    parsed: { name: "read" as const, arguments: args },
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
