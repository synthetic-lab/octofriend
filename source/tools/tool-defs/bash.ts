import { t } from "structural";
import { ToolError, defineTool, USER_ABORTED_ERROR_MESSAGE, planModeGuard } from "../common.ts";
import { AbortError, CommandFailedError } from "../../transports/transport-common.ts";

const ArgumentsSchema = t.subtype({
  timeout: t.num.comment(
    "A timeout for the command, in milliseconds. Be generous. You MUST specify this.",
  ),
  cmd: t.str.comment("The command to run"),
});

const Schema = t.subtype({
  name: t.value("shell"),
  arguments: ArgumentsSchema,
}).comment(`
  Runs a shell command in the cwd. This tool uses /bin/sh. Do NOT use bash-isms; they won't work.
  Only use POSIX-compliant shell.

  The shell command is run as a subshell, not connected to a PTY, so don't run interactive commands:
  only run commands that will work headless.

  Do NOT attempt to pipe echo, printf, etc commands to work around this. If it's interactive, either
  figure out a non-interactive variant to run instead, or if that's impossible, as a last resort you
  can ask the user to run the command, explaining that it's interactive.

  Often interactive commands provide flags to run them non-interactively. Prefer those flags.
`);

export default defineTool<t.GetType<typeof Schema>>(
  async (signal, transport, config, planFilePath) => {
    const guard = planModeGuard(planFilePath, Schema, ArgumentsSchema);
    if (guard) return guard;

    return {
      Schema,
      ArgumentsSchema,
      validate: async () => null,
      async run(abortSignal, transport, call) {
        const { cmd, timeout } = call.arguments;
        try {
          return { content: await transport.shell(abortSignal, cmd, timeout) };
        } catch (e) {
          if (e instanceof AbortError) throw new ToolError(USER_ABORTED_ERROR_MESSAGE);
          if (e instanceof CommandFailedError) throw new ToolError(e.message);
          throw e;
        }
      },
    };
  },
);
