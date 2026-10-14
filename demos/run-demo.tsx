import React, { type ReactNode } from "react";
import chalk from "chalk";
import { useApp } from "paintcannon-react";
import { useCtrlC } from "../source/components/exit-on-double-ctrl-c.tsx";
import { processes } from "../source/process-manager.ts";
import { renderInteractive } from "../source/cli/render-interactive.tsx";
import { THEME_COLOR } from "../source/theme.ts";

function ExitOnCtrlC({ children }: { children: ReactNode }) {
  const { exit } = useApp();
  useCtrlC(exit);
  return children;
}

type DemoFactory = (fixtures: AsyncDisposableStack) => ReactNode | Promise<ReactNode>;

export async function runDemo(createDemo: DemoFactory) {
  const manager = processes.manager();
  manager.installGlobalProcessSignalHandlers();

  const fixtures = new AsyncDisposableStack();
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => (cleanupPromise ??= fixtures.disposeAsync());
  const unregisterCleanup = manager.registerOctoExitCleanup(cleanup);

  try {
    const element = await createDemo(fixtures);
    const root = renderInteractive(<ExitOnCtrlC>{element}</ExitOnCtrlC>, { captureCtrlC: true });
    try {
      await root.waitUntilExit();
    } finally {
      root.unmount();
    }
  } finally {
    console.log(chalk.hex(THEME_COLOR)("\nCleaning up demo resources... Please don't force quit!"));
    await manager.terminateOnOctoExit();
    unregisterCleanup();
    await cleanup();
  }
}
