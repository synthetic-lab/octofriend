import { spawn } from "child_process";

export function spawnBrowser(url: string): Promise<boolean> {
  const command = browserOpenCommand(url);
  if (!command) return Promise.resolve(false);

  return new Promise(resolve => {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
    });

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", () => {
      resolve(false);
    });
  });
}

function browserOpenCommand(url: string): { command: string; args: string[] } | null {
  if (process.platform === "darwin") return { command: "open", args: [url] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}
