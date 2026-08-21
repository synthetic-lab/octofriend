import { processes } from "./octo-process.ts";

export function spawnBrowser(url: string): Promise<boolean> {
  const command = browserOpenCommand(url);
  if (!command) return Promise.resolve(false);

  return new Promise(resolve => {
    const octoProcess = processes.manager().spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
      surviveAfterOctoExit: true, // browser shouldn't be tied to Octo's state
    });

    octoProcess.once("spawn", () => {
      octoProcess.unref();
      resolve(true);
    });
    octoProcess.once("error", () => {
      resolve(false);
    });
  });
}

function browserOpenCommand(url: string): { command: string; args: string[] } | null {
  if (process.platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}
