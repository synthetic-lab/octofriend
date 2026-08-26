import { t } from "structural";
import { TOOL } from "../common.ts";
import { ok, err } from "../../libocto/result.ts";
import { MAX_SHELL_OUTPUT_LENGTH } from "../../transports/transport-common.ts";
import {
  backgroundProcesses,
  type BackgroundProcess,
  type BackgroundProcessStatus,
} from "../../background-process.ts";

export default TOOL.declare({
  name: "manage-background-process",
  description: `
Manages background processes started with the background-process tool: check their status and
output, kill them, or list the ones still running.
`.trim(),
  ArgumentsSchema: t.subtype({
    id: t.optional(
      t.str.comment("The background process id returned by the background-process tool"),
    ),
    timeout: t.optional(
      t.num.comment(
        'Optional, and only used by "poll": wait up to this many milliseconds for new output or exit before returning. If unset, poll returns immediately.',
      ),
    ),
    action: t.value("poll").or(t.value("kill")).or(t.value("list")).comment(`
"poll" returns the process's current status (running, or exited with its exit code/signal) plus
any stdout/stderr appended since the last poll: output is drained each poll, so poll repeatedly to
follow along. "kill" sends SIGTERM to the whole process group, escalating to SIGKILL after a grace
period, waits for the process to die, and returns its final status plus any remaining output.
"list" shows all currently-running background processes,
with its id and command. "poll" and "kill" require id; "list" ignores it.
`),
  }),
}).define(async () => ({
  async run({ signal, toolCall }) {
    const { id, action, timeout } = toolCall.parsed.arguments;
    const manager = backgroundProcesses.manager();
    switch (action) {
      case "list": {
        return ok({
          type: "output",
          content: [{ type: "text", content: formatList(manager.list()) }],
        });
      }
      case "poll": {
        if (id == null) return err(`The id argument is required to poll a background process`);
        const backgroundProcess = manager.poll(id);
        if (backgroundProcess == null) return err(`No background process with id ${id}`);
        if (timeout != null) await backgroundProcess.awaitActivity(timeout, signal);
        return ok({
          type: "output",
          content: [{ type: "text", content: formatProcess(backgroundProcess) }],
        });
      }
      case "kill": {
        if (id == null) return err(`The id argument is required to kill a background process`);
        const backgroundProcess = await manager.kill(id);
        if (backgroundProcess == null) return err(`No background process with id ${id}`);
        return ok({
          type: "output",
          content: [{ type: "text", content: formatProcess(backgroundProcess) }],
        });
      }
    }
  },
}));

function formatList(entries: BackgroundProcess[]): string {
  const running = entries.filter(entry => entry.status.state === "running");
  if (running.length === 0) return "No background processes currently running.";
  return [
    "Running background processes:",
    ...running.map(entry => `${entry.id}: ${entry.command}`),
  ].join("\n");
}

function formatProcess(backgroundProcess: BackgroundProcess): string {
  const latestOutput = backgroundProcess.drainUnreadOutput();
  let content = `Background process ${backgroundProcess.id}: ${formatStatus(backgroundProcess.status)}
Command: ${backgroundProcess.command}`;
  if (backgroundProcess.outputExceeded) {
    content += `\nOutput exceeded the ${MAX_SHELL_OUTPUT_LENGTH} character limit and was discarded; the process was terminated.`;
  } else if (latestOutput.length > 0) {
    content += `\nNew output:\n${latestOutput}`;
  } else {
    content += "\nNo new output.";
  }
  return content;
}

function formatStatus(status: BackgroundProcessStatus): string {
  if (status.state === "running") return "running";
  if (status.code != null) return `exited with code ${status.code}`;
  if (status.signal != null) return `killed by signal ${status.signal}`;
  return "exited";
}
