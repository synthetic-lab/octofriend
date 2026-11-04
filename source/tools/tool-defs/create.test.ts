import { describe, expect, it } from "bun:test";
import { err, ok } from "../../libocto/result.ts";
import { MockTransport } from "../../transports/mock.ts";
import { fileTracker } from "../file-tracker.ts";
import createToolFactory from "./create.ts";

const config = { yourName: "Test", models: [] };

async function createTool(transport: MockTransport) {
  const tool = await createToolFactory({
    signal: new AbortController().signal,
    transport,
    data: config,
  });
  if (tool == null) throw new Error("create tool did not load");
  return tool;
}

function toolCall(filePath: string) {
  const args = { filePath, content: "new contents" };
  return {
    toolCallId: "create-call",
    original: { name: "create" as const, arguments: args },
    parsed: { name: "create" as const, arguments: args },
  };
}

describe("create tool", () => {
  it.each(["mkdir", "writeFile", "modTime"] as const)(
    "propagates the FileTracker error when %s fails",
    async stage => {
      const transport = new MockTransport({});
      transport[stage] = async () => {
        throw new Error("Filesystem failure");
      };
      const tool = await createTool(transport);
      expect(
        await tool.run({
          signal: new AbortController().signal,
          transport,
          toolCall: toolCall("new.txt"),
          data: config,
        }),
      ).toEqual(err("Failed to write file new.txt"));
    },
  );

  it.each(["validate", "run"] as const)("rejects an existing file during %s", async operation => {
    const signal = new AbortController().signal;
    const transport = new MockTransport({ files: { "exists.txt": "original" } });
    const tool = await createTool(transport);
    const call = toolCall("exists.txt");
    const result =
      operation === "validate"
        ? await tool.validate(signal, transport, call, config)
        : await tool.run({ signal, transport, toolCall: call, data: config });

    expect(result).toEqual(err("File already exists"));
    expect(await transport.readFile(signal, "exists.txt")).toBe("original");
  });

  it("returns an error if path resolution fails during validation", async () => {
    const transport = new MockTransport({});
    transport.resolvePath = async () =>
      err("Could not resolve path new.txt: Path resolution failed");
    const tool = await createTool(transport);
    expect(
      await tool.validate(new AbortController().signal, transport, toolCall("new.txt"), config),
    ).toEqual(err("Could not resolve path new.txt: Path resolution failed"));
  });

  it("creates the file and records the successful mutation", async () => {
    const signal = new AbortController().signal;
    const transport = new MockTransport({});
    const tool = await createTool(transport);
    expect(
      await tool.run({ signal, transport, toolCall: toolCall("create-success.txt"), data: config }),
    ).toMatchObject({
      success: true,
      data: { type: "custom-ir", data: { role: "file-mutate", path: "create-success.txt" } },
    });
    expect(await transport.readFile(signal, "create-success.txt")).toBe("new contents");
    expect(await fileTracker.isOutdated(transport, signal, "create-success.txt")).toEqual(
      ok(false),
    );
  });
});
