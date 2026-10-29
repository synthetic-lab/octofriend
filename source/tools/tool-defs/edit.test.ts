import { describe, expect, it } from "bun:test";
import editToolFactory from "./edit.ts";
import { FILE_OUTDATED_ERROR_MESSAGE } from "../common.ts";
import { fileTracker } from "../file-tracker.ts";
import { err, unwrap } from "../../libocto/result.ts";
import { MockTransport } from "../../transports/mock.ts";
import { AbortError, type Transport } from "../../transports/transport-common.ts";

function createTransport(files: Record<string, string>): Transport {
  return new MockTransport({ cwd: "/repo", files });
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
  it.each([
    { stage: "resolvePath", code: "ENOENT" },
    { stage: "mkdir", code: "EACCES" },
    { stage: "writeFile", code: "EROFS" },
    { stage: "writeFile", code: "ENOSPC" },
    { stage: "modTime", code: "EIO" },
  ] as const)("returns a tool error when $stage fails with $code", async ({ stage, code }) => {
    const signal = new AbortController().signal;
    const filePath = `edit-${stage}-${code}.txt`;
    const transport = new MockTransport({ files: { [filePath]: "old contents" } });
    const tool = await createEditTool(transport);
    await fileTracker.read(transport, signal, filePath);
    const modTime = transport.modTime.bind(transport);
    transport[stage] = async () => {
      throw Object.assign(new Error(`${code}: filesystem operation failed`), { code });
    };

    const result = await tool.run({
      signal,
      transport,
      toolCall: editToolCall({ filePath, search: "old", replace: "new" }),
      data: { yourName: "Test", models: [] },
    });
    expect(result).toEqual(err(`Failed to edit file ${filePath}`));
    expect(await transport.readFile(signal, filePath)).toBe(
      stage === "modTime" ? "new contents" : "old contents",
    );
    if (stage === "modTime") {
      transport.modTime = modTime;
      expect(await fileTracker.isOutdated(transport, signal, filePath)).toBe(true);
    }
  });

  it.each(["validate", "run"] as const)(
    "returns a validation error from %s when the stale-file check cannot resolve the path",
    async operation => {
      const signal = new AbortController().signal;
      const transport = new MockTransport({ files: { "missing-search.txt": "current contents" } });
      const tool = await createEditTool(transport);
      transport.resolvePath = async () => {
        throw new Error("Docker path resolution failed");
      };
      const toolCall = editToolCall({
        filePath: "missing-search.txt",
        search: "not present",
        replace: "new",
      });
      const result =
        operation === "validate"
          ? await tool.validate(signal, transport, toolCall, { yourName: "Test", models: [] })
          : await tool.run({ signal, transport, toolCall, data: { yourName: "Test", models: [] } });
      expect(result).toEqual(err("Could not check file missing-search.txt for changes"));
      expect(await transport.readFile(signal, "missing-search.txt")).toBe("current contents");
    },
  );

  it("returns a tool error when an in-flight write is cancelled", async () => {
    const controller = new AbortController();
    const transport = new MockTransport({ files: { "cancel-edit.txt": "old" } });
    const tool = await createEditTool(transport);
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
      toolCall: editToolCall({ filePath: "cancel-edit.txt", search: "old", replace: "new" }),
      data: { yourName: "Test", models: [] },
    });
    await writing;
    controller.abort();
    await expect(result).resolves.toEqual(err("Failed to edit file cancel-edit.txt"));
    expect(await transport.readFile(new AbortController().signal, "cancel-edit.txt")).toBe("old");
  });

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
