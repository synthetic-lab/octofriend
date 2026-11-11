import { describe, expect, it, mock } from "bun:test";
import { LspClient } from "./client.ts";
import { err, ok } from "../result.ts";
import { MockTransport } from "../../transports/mock.ts";
import { withLspFile } from "./lsp-common.ts";

function createClient(transport: MockTransport) {
  return new LspClient(
    { serverName: "test", command: [], extensions: [".txt"], rootCandidates: [] },
    transport.cwd,
    transport,
  );
}

describe("withLspFile", () => {
  it.each(["resolvePath", "readFile", "modTime"] as const)(
    "propagates a FileTracker error when %s fails without invoking the LSP client",
    async stage => {
      const transport = new MockTransport({ files: { "file.txt": "contents" } });
      transport[stage] = async () => err("Filesystem failure");
      const client = createClient(transport);
      const openFile = mock(async () => {});
      client.openFile = openFile;
      const query = mock(async () => ok("answer"));

      const result = await withLspFile(
        new AbortController().signal,
        transport,
        client,
        "file.txt",
        query,
      );

      expect(result).toEqual(err("Filesystem failure"));
      expect(openFile).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("opens the file contents and returns the query result", async () => {
    const transport = new MockTransport({ files: { "file.txt": "contents" } });
    const client = createClient(transport);
    const openFile = mock(async (_path: string, _content: string) => {});
    client.openFile = openFile;
    const query = mock(async () => ok("answer"));

    expect(
      await withLspFile(new AbortController().signal, transport, client, "file.txt", query),
    ).toEqual(ok("answer"));
    expect(openFile).toHaveBeenCalledWith("file.txt", "contents");
    expect(query).toHaveBeenCalledWith(client);
  });

  it("wraps a query error with the file path", async () => {
    const transport = new MockTransport({ files: { "file.txt": "contents" } });
    const client = createClient(transport);
    client.openFile = mock(async () => {});
    const query = mock(async () => err("server crashed"));

    expect(
      await withLspFile(new AbortController().signal, transport, client, "file.txt", query),
    ).toEqual(err("LSP query failed for file.txt: server crashed"));
  });
});
