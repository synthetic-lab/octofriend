import {
  type Transport,
  AbortError,
  CommandFailedError,
  MAX_SHELL_OUTPUT_LENGTH,
  ShellOutput,
} from "./transport-common.ts";

const KILL_GRACE_MS = 500;

export function runShell(
  transport: Transport,
  signal: AbortSignal,
  cmd: string,
  timeout: number,
  shell = "bash",
): Promise<string> {
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise<string>((resolve, reject) => {
    const shellProcess = transport.spawn(cmd, {
      cwd: transport.cwd,
      shell,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    if (!shellProcess.stdout || !shellProcess.stderr) {
      reject(new Error("Failed to spawn shell process with piped stdio"));
      return;
    }

    const output = new ShellOutput();
    let aborted = false;
    let timedOut = false;
    let killed = false;

    function killGroup() {
      if (killed) return;
      killed = true;
      shellProcess.terminate({ graceMs: KILL_GRACE_MS });
    }

    function onAbort() {
      aborted = true;
      killGroup();
    }

    function cleanup() {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeoutHandler);
    }

    const timeoutHandler = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeout);

    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort);

    shellProcess.stdout.on("data", data => {
      if (!output.append(data)) killGroup();
    });

    shellProcess.stderr.on("data", data => {
      if (!output.append(data)) killGroup();
    });

    shellProcess.on("close", code => {
      cleanup();
      if (aborted) {
        reject(new AbortError());
        return;
      }
      const commandOutput = output.getOutput();
      if (commandOutput == null) {
        reject(
          new CommandFailedError(
            `Command output exceeded the ${MAX_SHELL_OUTPUT_LENGTH} character limit and was terminated.`,
          ),
        );
        return;
      }
      if (timedOut) {
        reject(
          new CommandFailedError(
            `Command timed out.
output: ${commandOutput}`,
          ),
        );
        return;
      }
      if (code === 0) {
        resolve(commandOutput);
      } else {
        if (code == null) {
          reject(
            new CommandFailedError(
              `Command killed by signal.
output: ${commandOutput}`,
            ),
          );
        } else {
          reject(
            new CommandFailedError(
              `Command exited with code: ${code}
output: ${commandOutput}`,
              code,
            ),
          );
        }
      }
    });

    shellProcess.on("error", err => {
      cleanup();
      if (aborted) {
        reject(new AbortError());
        return;
      }
      reject(new CommandFailedError(`Command failed: ${err.message}`));
    });
  });
}
