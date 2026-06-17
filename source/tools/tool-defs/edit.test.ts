import { describe, expect, it } from "vitest";
import editToolFactory from "./edit.ts";
import { FILE_OUTDATED_ERROR_MESSAGE } from "../common.ts";
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

async function createEditTool(transport: Transport) {
  const tool = await editToolFactory({
    signal: new AbortController().signal,
    transport,
    data: {} as never,
  });
  if (!tool) {
    throw new Error("edit tool did not load");
  }
  return tool;
}

function editToolCall(args: { filePath: string; search: string; replace: string }) {
  return {
    toolCallId: "test-call",
    original: { name: "edit" as const, arguments: args },
    parsed: {
      name: "edit" as const,
      arguments: {
        ...args,
        originalFileContents: "",
      },
    },
  };
}

describe("edit tool", () => {
  it("edits stale files optimistically when the search string still matches", async () => {
    const signal = new AbortController().signal;
    const transport = createTransport({
      "/repo/optimistic.txt": "one\ntwo\nthree",
    });
    const tool = await createEditTool(transport);

    await fileTracker.read(transport, signal, "optimistic.txt");
    await transport.writeFile(signal, "optimistic.txt", "zero\none\ntwo\nthree");
    await expect(fileTracker.isOutdated(transport, signal, "optimistic.txt")).resolves.toBe(true);

    const result = unwrap(
      await tool.run({
        signal,
        transport,
        toolCall: editToolCall({
          filePath: "optimistic.txt",
          search: "two",
          replace: "TWO",
        }),
        data: {} as never,
      }),
    );

    expect(result).toMatchObject({
      type: "custom-ir",
      data: {
        role: "file-mutate",
        path: "optimistic.txt",
      },
    });
    await expect(transport.readFile(signal, "optimistic.txt")).resolves.toBe(
      "zero\none\nTWO\nthree",
    );
  });

  it("returns an outdated error only when a failed edit is stale", async () => {
    const signal = new AbortController().signal;
    const freshTransport = createTransport({
      "/repo/fresh-missing.txt": "current contents",
    });
    const staleTransport = createTransport({
      "/repo/stale-missing.txt": "before edit",
    });
    const freshTool = await createEditTool(freshTransport);
    const staleTool = await createEditTool(staleTransport);

    const freshResult = await freshTool.run({
      signal,
      transport: freshTransport,
      toolCall: editToolCall({
        filePath: "fresh-missing.txt",
        search: "missing text",
        replace: "replacement",
      }),
      data: {} as never,
    });

    expect(freshResult.success).toBe(false);
    if (freshResult.success) return;
    expect(freshResult.error).toContain("Could not find search string");
    expect(freshResult.error).not.toBe(FILE_OUTDATED_ERROR_MESSAGE);

    await fileTracker.read(staleTransport, signal, "stale-missing.txt");
    await staleTransport.writeFile(signal, "stale-missing.txt", "after edit");

    const staleResult = await staleTool.run({
      signal,
      transport: staleTransport,
      toolCall: editToolCall({
        filePath: "stale-missing.txt",
        search: "before edit",
        replace: "replacement",
      }),
      data: {} as never,
    });

    expect(staleResult.success).toBe(false);
    if (staleResult.success) return;
    expect(staleResult.error).toBe(FILE_OUTDATED_ERROR_MESSAGE);
    await expect(staleTransport.readFile(signal, "stale-missing.txt")).resolves.toBe("after edit");
  });
});
