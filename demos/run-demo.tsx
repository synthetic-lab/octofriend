import React, { type ComponentType } from "react";
import fs from "fs/promises";
import os from "os";
import path from "path";
import chalk from "chalk";
import { useApp } from "paintcannon-react";
import { useCtrlC } from "../source/components/exit-on-double-ctrl-c.tsx";
import { processes } from "../source/process-manager.ts";
import { renderInteractive } from "../source/cli/render-interactive.tsx";
import { THEME_COLOR } from "../source/theme.ts";

export type DemoProps = { directory: string };

function ExitOnCtrlC({ children }: { children: React.ReactNode }) {
  const { exit } = useApp();
  useCtrlC(exit);
  return children;
}

export async function runDemo(Demo: ComponentType<DemoProps>) {
  const manager = processes.manager();
  manager.installGlobalProcessSignalHandlers();

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "octo-demo-"));
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  const unregisterCleanup = manager.registerOctoExitCleanup(cleanup);
  try {
    const root = renderInteractive(
      <ExitOnCtrlC>
        <Demo directory={directory} />
      </ExitOnCtrlC>,
      { captureCtrlC: true },
    );
    try {
      await root.waitUntilExit();
    } finally {
      root.unmount();
    }
  } finally {
    console.log(
      chalk.hex(THEME_COLOR)("\nCleaning up temporary files... Please don't force quit!"),
    );
    await manager.terminateOnOctoExit();
    unregisterCleanup();
    await cleanup();
  }
}
