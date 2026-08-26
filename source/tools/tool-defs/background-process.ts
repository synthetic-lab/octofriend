import { t } from "structural";
import { TOOL } from "../common.ts";
import { ok } from "../../libocto/result.ts";
import { backgroundProcesses } from "../../background-process.ts";

export default TOOL.declare({
  name: "background-process",
  description: `
Runs a shell command in the background and returns immediately with a process id. The command is
run by bash in the cwd, not connected to a PTY, and can't read stdin. You should only run commands in
this tool that work headless.

Use this for long-running commands you don't want to block on, like dev servers or file watchers.
For commands that finish quickly, use the shell tool instead.

stdout and stderr are captured; use the manage-background-process tool with the returned id to
poll output and status, or to kill the process. Background processes are killed when Octo exits.
`.trim(),
  ArgumentsSchema: t.subtype({
    cmd: t.str.comment("The command to run in the background"),
  }),
}).define(async () => ({
  async run({ toolCall }) {
    const backgroundProcess = backgroundProcesses.manager().start(toolCall.parsed.arguments.cmd);
    return ok({
      type: "output",
      content: [
        {
          type: "text",
          content:
            `Started background process ${backgroundProcess.id}. ` +
            `Poll its output and status, or kill it, with manage-background-process.`,
        },
      ],
    });
  },
}));
