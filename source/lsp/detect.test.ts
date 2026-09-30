import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { LocalTransport } from "../transports/local.ts";
import { isCommandExecutable } from "./detect.ts";

describe("isCommandExecutable", () => {
  it("returns false when the caller aborts the probe", async () => {
    const transport = new LocalTransport();
    const controller = new AbortController();
    controller.abort();
    expect(await isCommandExecutable(controller.signal, "/bin/sh", transport)).toBe(false);
  });

  it("returns false when the shell cannot resolve the command", async () => {
    const transport = new LocalTransport();
    expect(
      await isCommandExecutable(
        AbortSignal.timeout(5000),
        "octofriend-command-that-does-not-exist",
        transport,
      ),
    ).toBe(false);
  });

  it("returns false for a shell builtin that cannot be spawned as a file", async () => {
    const transport = new LocalTransport();
    expect(await isCommandExecutable(AbortSignal.timeout(5000), "cd", transport)).toBe(false);
  });

  it("quotes executable paths containing spaces", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "octofriend lsp "));
    const command = path.join(directory, "language server");
    await writeFile(command, "#!/bin/sh\nexit 0\n");
    await chmod(command, 0o755);
    const transport = new LocalTransport();
    try {
      expect(await isCommandExecutable(AbortSignal.timeout(5000), command, transport)).toBe(true);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
