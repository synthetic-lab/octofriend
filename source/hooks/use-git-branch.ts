import { useEffect, useState } from "react";
import type { FsWatcher, Transport } from "../transports/transport-common.ts";
import { useTransport } from "../transport-context.ts";

const GIT_COMMAND_TIMEOUT_MS = 5_000;

type DetectedGit = {
  branch: string | null;
  gitDir: string | null;
};

export function useGitBranch(): string | null {
  const transport = useTransport();
  const cwd = transport.cwd;
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => watchGitBranch(transport, cwd, setBranch), [transport, cwd]);

  return branch;
}

function watchGitBranch(
  transport: Transport,
  cwd: string,
  onBranch: (branch: string | null) => void,
): () => void {
  const controller = new AbortController();
  let watcher: FsWatcher | null = null;

  const refresh = async () => {
    const entry = await detectGit(transport, controller.signal);
    if (controller.signal.aborted) return;
    onBranch(entry.branch);
    await watcher?.close();
    watcher = null;

    // In a repo, watch HEAD for branch switches; outside one, watch for .git being created
    // so the HUD lights up when the user runs git init.
    let path = `${cwd}/.git`;
    if (entry.gitDir != null) path = `${entry.gitDir}/HEAD`;

    const result = await transport.watchFile(controller.signal, path, () => void refresh());
    if (controller.signal.aborted || !result.success) return;
    watcher = result.data;
  };

  void refresh();

  return () => {
    controller.abort();
    if (watcher) void watcher.close();
  };
}

export async function detectGit(transport: Transport, signal: AbortSignal): Promise<DetectedGit> {
  const result = await transport.shell(
    signal,
    "git rev-parse --abbrev-ref HEAD --absolute-git-dir",
    GIT_COMMAND_TIMEOUT_MS,
  );
  if (!result.success) return { branch: null, gitDir: null };

  const lines = result.data
    .trim()
    .split("\n")
    .map(line => line.trim());
  let branch: string | null = lines[0] ?? "";
  let gitDir: string | null = lines[1] ?? "";
  // A bare "HEAD" means detached HEAD.
  if (branch === "" || branch === "HEAD") branch = null;
  if (gitDir === "") gitDir = null;
  return { branch, gitDir };
}
