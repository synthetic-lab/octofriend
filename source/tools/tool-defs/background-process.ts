import { t } from "structural";
import { TOOL } from "../common.ts";
import { ok } from "../../libocto/result.ts";
import { backgroundProcesses } from "../../background-process.ts";

export default TOOL.declare({
  name: "background-process",
  description: `
Runs a shell command in the background and returns immediately with a process id. Give each process
a short, descriptive label that is unique among the currently-running background processes. The
command is run by bash in the cwd, not connected to a PTY, and can't read stdin. You should only run
commands in this tool that work headless.

Use this for long-running commands you don't want to block on, like dev servers or file watchers.
For commands that finish quickly, use the shell tool instead.

stdout and stderr are captured; use the manage-background-process tool with the returned id to
poll output and status, or to kill the process. Background processes are killed when Octo exits.
`.trim(),
  ArgumentsSchema: t.subtype({
    cmd: t.str.comment("The command to run in the background"),
    label: t.str.comment(
      'A short descriptive label unique among active background processes, like "dev-server" or "test-watcher"',
    ),
  }),
}).define(async () => ({
  async run({ toolCall }) {
    const { cmd, label } = toolCall.parsed.arguments;
    const backgroundProcess = backgroundProcesses.manager().start(cmd, label);
    return ok({
      type: "output",
      content: [
        {
          type: "text",
          content:
            `Started background process ${backgroundProcess.label} (${backgroundProcess.id}). ` +
            `Poll its output and status, or kill it, with manage-background-process.`,
        },
      ],
    });
  },
}));
