import { describe, expect, it } from "vitest";
import readToolFactory from "./read.ts";
import { fileTracker } from "../file-tracker.ts";
import { Transport } from "../../transports/transport-common.ts";

function createTransport(files: Record<string, string>): Transport {
  const modTimes = new Map(Object.keys(files).map((file, index) => [file, index + 1]));

  return {
    cwd: "/repo",
    async writeFile(_signal, file, contents) {
      files[file] = contents;
      modTimes.set(file, (modTimes.get(file) ?? 0) + 1);
    },
    async readFile(_signal, file) {
      const content = files[file];
      if (content == null) {
        throw new Error(`No such file: ${file}`);
      }
      return content;
    },
    async pathExists(_signal, file) {
      return files[file] != null;
    },
    async isDirectory() {
      return false;
    },
    async mkdir() {},
    async readdir() {
      return [];
    },
    async modTime(_signal, file) {
      const modTime = modTimes.get(file);
      if (modTime == null) {
        throw new Error(`No such file: ${file}`);
      }
      return modTime;
    },
    async resolvePath(_signal, file) {
      return file.startsWith("/") ? file : `/repo/${file}`;
    },
    async shell() {
      return "";
    },
    async close() {},
  };
}

async function createReadTool(transport: Transport) {
  const tool = await readToolFactory(new AbortController().signal, transport, {} as never);
  if (!tool) {
    throw new Error("read tool did not load");
  }
  return tool;
}

describe("read tool", () => {
  it("can return a line range with original file line numbers", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/notes.txt": "one\ntwo\nthree\nfour\nfive",
    });
    const tool = await createReadTool(transport);

    const result = await tool.run(
      signal,
      transport,
      {
        original: {
          name: "read",
          arguments: { filePath: "notes.txt", offset: 2, limit: 2 } as any,
        },
        parsed: {
          name: "read",
          arguments: { filePath: "notes.txt", offset: 2, limit: 2 } as any,
        },
      },
      {} as never,
      null,
    );

    expect(result).toEqual({
      content: "Showing lines 2-3 of 5 from notes.txt\n2: two\n3: three",
      lines: 5,
    });
  });

  it("does not allow edits after only a partial read", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/partial-only.txt": "one\ntwo\nthree",
    });
    const tool = await createReadTool(transport);

    await tool.run(
      signal,
      transport,
      {
        original: {
          name: "read",
          arguments: { filePath: "partial-only.txt", offset: 1, limit: 1 } as any,
        },
        parsed: {
          name: "read",
          arguments: { filePath: "partial-only.txt", offset: 1, limit: 1 } as any,
        },
      },
      {} as never,
      null,
    );

    await expect(fileTracker.canEdit(transport, signal, "partial-only.txt")).resolves.toBe(false);
  });

  it("upgrades partial requests to full reads after a current full read", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/already-full.txt": "one\ntwo\nthree",
    });
    const tool = await createReadTool(transport);

    await tool.run(
      signal,
      transport,
      {
        original: { name: "read", arguments: { filePath: "already-full.txt" } },
        parsed: { name: "read", arguments: { filePath: "already-full.txt" } },
      },
      {} as never,
      null,
    );

    const result = await tool.run(
      signal,
      transport,
      {
        original: {
          name: "read",
          arguments: { filePath: "already-full.txt", offset: 2, limit: 1 } as any,
        },
        parsed: {
          name: "read",
          arguments: { filePath: "already-full.txt", offset: 2, limit: 1 } as any,
        },
      },
      {} as never,
      null,
    );

    expect(result.content).toBe("1: one\n2: two\n3: three");
    await expect(fileTracker.canEdit(transport, signal, "already-full.txt")).resolves.toBe(true);
  });
});
