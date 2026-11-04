import { describe, expect, it } from "bun:test";
import { err, ok, unwrap } from "../libocto/result.ts";
import { MockTransport } from "../transports/mock.ts";
import { FileTracker } from "./file-tracker.ts";

describe("FileTracker", () => {
  it.each([
    "readUntracked",
    "read",
    "recordFileReadTimestamp",
    "write",
    "isOutdated",
    "canCreate",
    "assertCanCreate",
  ] as const)("returns a Result when %s cannot resolve a path", async operation => {
    const tracker = new FileTracker();
    const transport = new MockTransport({});
    const signal = new AbortController().signal;
    transport.resolvePath = async (_, file) =>
      err(`Could not resolve path ${file}: Path resolution failed`);

    const result =
      operation === "write"
        ? await tracker.write(transport, signal, "file.txt", "new contents")
        : await tracker[operation](transport, signal, "file.txt");
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("file.txt") });
  });

  it.each(["read", "readUntracked"] as const)(
    "returns a read error from %s when the transport fails",
    async operation => {
      const tracker = new FileTracker();
      const transport = new MockTransport({});
      const signal = new AbortController().signal;
      transport.readFile = async () => err("Could not read file file.txt: EACCES");

      expect(await tracker[operation](transport, signal, "file.txt")).toEqual(
        err("Could not read file file.txt: EACCES"),
      );
    },
  );

  it.each(["read", "recordFileReadTimestamp", "write"] as const)(
    "does not refresh the tracked timestamp when %s fails to stat",
    async operation => {
      const tracker = new FileTracker();
      const transport = new MockTransport({ files: { "file.txt": "original" } });
      const signal = new AbortController().signal;
      unwrap(await tracker.read(transport, signal, "file.txt"));
      await transport.writeFile(signal, "file.txt", "external edit");
      const modTime = transport.modTime.bind(transport);
      transport.modTime = async () => err("Could not get modified time for file.txt: EIO");

      const result =
        operation === "write"
          ? await tracker.write(transport, signal, "file.txt", "another edit")
          : await tracker[operation](transport, signal, "file.txt");
      expect(result).toMatchObject({ success: false, error: expect.stringContaining("file.txt") });

      transport.modTime = modTime;
      expect(await tracker.isOutdated(transport, signal, "file.txt")).toEqual(ok(true));
    },
  );

  it("only tracks successful full reads, timestamp recordings, and writes", async () => {
    const tracker = new FileTracker();
    const transport = new MockTransport({ files: { "file.txt": "original" } });
    const signal = new AbortController().signal;

    expect(await tracker.readUntracked(transport, signal, "file.txt")).toEqual(ok("original"));
    await transport.writeFile(signal, "file.txt", "external edit");
    expect(await tracker.isOutdated(transport, signal, "file.txt")).toEqual(ok(false));

    expect(await tracker.read(transport, signal, "file.txt")).toEqual(ok("external edit"));
    await transport.writeFile(signal, "file.txt", "another edit");
    expect(await tracker.isOutdated(transport, signal, "file.txt")).toEqual(ok(true));
    expect(await tracker.recordFileReadTimestamp(transport, signal, "file.txt")).toEqual(
      ok(undefined),
    );
    expect(await tracker.isOutdated(transport, signal, "file.txt")).toEqual(ok(false));

    expect(await tracker.write(transport, signal, "file.txt", "written")).toEqual(
      ok("/repo/file.txt"),
    );
    expect(await transport.readFile(signal, "file.txt")).toEqual(ok("written"));
    expect(await tracker.isOutdated(transport, signal, "file.txt")).toEqual(ok(false));
  });

  it("returns Results for missing and existing create targets", async () => {
    const tracker = new FileTracker();
    const transport = new MockTransport({ files: { "exists.txt": "original" } });
    const signal = new AbortController().signal;

    expect(await tracker.canCreate(transport, signal, "new.txt")).toEqual(ok(true));
    expect(await tracker.assertCanCreate(transport, signal, "new.txt")).toEqual(ok(null));
    expect(await tracker.canCreate(transport, signal, "exists.txt")).toEqual(ok(false));
    expect(await tracker.assertCanCreate(transport, signal, "exists.txt")).toEqual(
      err("File already exists"),
    );
  });

  it("retains the stale-check fallback for an inaccessible tracked file", async () => {
    const tracker = new FileTracker();
    const transport = new MockTransport({ files: { "file.txt": "original" } });
    const signal = new AbortController().signal;
    unwrap(await tracker.read(transport, signal, "file.txt"));
    transport.modTime = async () => err("File no longer accessible");

    expect(await tracker.isOutdated(transport, signal, "file.txt")).toEqual(ok(false));
  });
});
