import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { MockTransport } from "libocto/testing";
import { AbortError, CommandFailedError } from "../transport.ts";
import { err, ok } from "../result.ts";
import { isCommandExecutable } from "./detect.ts";

// Run the probes in a real shell so builtin and quoting behavior are exercised.
const transport = new MockTransport({});
transport.shell = async (signal, command) => {
  if (signal.aborted) return err(new AbortError());
  const { exitCode, stdout, stderr } = Bun.spawnSync(["sh", "-c", command]);
  return exitCode === 0
    ? ok(stdout.toString())
    : err(new CommandFailedError(stderr.toString(), exitCode));
};

describe("isCommandExecutable", () => {
  it("returns false when the caller aborts the probe", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await isCommandExecutable(controller.signal, "/bin/sh", transport)).toBe(false);
  });

  it("returns false when the shell cannot resolve the command", async () => {
    expect(
      await isCommandExecutable(
        AbortSignal.timeout(5000),
        "octofriend-command-that-does-not-exist",
        transport,
      ),
    ).toBe(false);
  });

  it("returns false for a shell builtin that cannot be spawned as a file", async () => {
    expect(await isCommandExecutable(AbortSignal.timeout(5000), "cd", transport)).toBe(false);
  });

  it("quotes executable paths containing spaces", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "octofriend lsp "));
    const command = path.join(directory, "language server");
    await writeFile(command, "#!/bin/sh\nexit 0\n");
    await chmod(command, 0o755);
    try {
      expect(await isCommandExecutable(AbortSignal.timeout(5000), command, transport)).toBe(true);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
