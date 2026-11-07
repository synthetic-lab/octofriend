import React, { createContext, useContext, useEffect, useState } from "react";
import { useApp } from "paintcannon-react";
import { getEnvVar, type FsWatcher, type Transport } from "./libocto/transport.ts";

const ENVIRONMENT_TIMEOUT_MS = 5_000;

type Environment = {
  branch: string | null;
  home: string | null;
};

type SeededEnvironment = {
  transport: Transport;
  cwd: string;
  value: Environment;
};

const EnvironmentContext = createContext<Environment | null>(null);

export function useEnvironment(): Environment {
  const environment = useContext(EnvironmentContext);
  if (environment == null) throw new Error("Environment is not initialized.");
  return environment;
}

export function EnvironmentProvider({
  transport,
  children,
}: {
  transport: Transport;
  children: React.ReactNode;
}) {
  const { exit } = useApp();
  const cwd = transport.cwd;
  const [environment, setEnvironment] = useState<SeededEnvironment | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let watcher: FsWatcher | null = null;
    let value: Environment = { branch: null, home: null };
    let gitSeeded = false;
    let homeSeeded = false;
    let refreshVersion = 0;

    const publish = () => {
      if (!controller.signal.aborted && gitSeeded && homeSeeded) {
        setEnvironment({ transport, cwd, value });
      }
    };
    const onError = (error: unknown) => {
      if (controller.signal.aborted) return;
      exit(error instanceof Error ? error : new Error(String(error)));
    };
    const refreshGit = async () => {
      const version = ++refreshVersion;
      const current = () => !controller.signal.aborted && version === refreshVersion;
      if (!current()) return;
      const entry = await detectGit(transport, controller.signal);
      if (!current()) return;
      value = { ...value, branch: entry.branch };
      gitSeeded = true;
      publish();
      const previousWatcher = watcher;
      watcher = null;
      await previousWatcher?.close();
      if (!current()) return;

      // Watch HEAD for branch switches, or .git for repository creation outside a repo.
      const path = entry.gitDir == null ? `${cwd}/.git` : `${entry.gitDir}/HEAD`;
      const result = await transport.watchFile(controller.signal, path, () => {
        void refreshGit().catch(onError);
      });
      if (!result.success) return;
      if (!current()) {
        await result.data.close();
        return;
      }
      watcher = result.data;
    };

    // Start both reads together; publish only when both initial values are known.
    void refreshGit().catch(onError);
    void getEnvVar(controller.signal, transport, "HOME", ENVIRONMENT_TIMEOUT_MS).then(result => {
      if (controller.signal.aborted) return;
      value = { ...value, home: result.success && result.data !== "" ? result.data : null };
      homeSeeded = true;
      publish();
    }, onError);

    return () => {
      controller.abort();
      if (watcher) void watcher.close();
    };
  }, [transport, cwd, exit]);

  // Gate the app itself so transcript layout effects run only after its first real mount.
  if (environment == null || environment.transport !== transport || environment.cwd !== cwd) {
    return null;
  }
  return (
    <EnvironmentContext.Provider value={environment.value}>{children}</EnvironmentContext.Provider>
  );
}

type DetectedGit = {
  branch: string | null;
  gitDir: string | null;
};

async function detectGit(transport: Transport, signal: AbortSignal): Promise<DetectedGit> {
  const result = await transport.shell(
    signal,
    "git rev-parse --abbrev-ref HEAD --absolute-git-dir",
    ENVIRONMENT_TIMEOUT_MS,
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
