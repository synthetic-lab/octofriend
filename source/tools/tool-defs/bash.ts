import { t } from "structural";
import { BASE_IR, USER_ABORTED_ERROR_MESSAGE, toolOutput } from "../common.ts";
import { AbortError, CommandFailedError } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

const ArgumentsSchema = t.subtype({
  timeout: t.num.comment(
    "A timeout for the command, in milliseconds. Be generous. You MUST specify this.",
  ),
  cmd: t.str.comment("The command to run"),
});

export default BASE_IR.declare({
  name: "shell",
  description: `
Runs a shell command in the cwd. This tool uses /bin/sh. Do NOT use bash-isms; they won't work.
Only use POSIX-compliant shell.

The shell command is run as a subshell, not connected to a PTY, so don't run interactive commands:
only run commands that will work headless.

Do NOT attempt to pipe echo, printf, etc commands to work around this. If it's interactive, either
figure out a non-interactive variant to run instead, or if that's impossible, as a last resort you
can ask the user to run the command, explaining that it's interactive.

Often interactive commands provide flags to run them non-interactively. Prefer those flags.
`.trim(),
  ArgumentsSchema,
}).define(async () => ({
  async run({ signal, transport, toolCall }) {
    const { cmd, timeout } = toolCall.parsed.arguments;
    try {
      return toolOutput(await transport.shell(signal, cmd, timeout));
    } catch (e) {
      if (e instanceof AbortError) return result.err(USER_ABORTED_ERROR_MESSAGE);
      if (e instanceof CommandFailedError) return result.err(e.message);
      throw e;
    }
  },
}));
