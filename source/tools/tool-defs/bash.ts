import { t } from "structural";
import { ToolError, ToolDef, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { AbortError, CommandFailedError } from "../../transports/transport-common.ts";

const ArgumentsSchema = t.subtype({
  cmd: t.str.comment("The command to run"),
  timeout: t.num.comment("A timeout for the command, in milliseconds. Be generous."),
});

const Schema = t.subtype({
	name: t.value("bash"),
	arguments: ArgumentsSchema,
}).comment(`
  Runs a bash command in the cwd. The bash command is run as a subshell, not connected to a PTY, so
  don't run interactive commands: only run commands that will work headless.

  Do NOT attempt to pipe echo, printf, etc commands to work around this. If it's interactive, either
  figure out a non-interactive variant to run instead, or if that's impossible, as a last resort you
  can ask the user to run the command, explaining that it's interactive.

  Often interactive commands provide flags to run them non-interactively. Prefer those flags.
`);

export default {
  Schema, ArgumentsSchema,
  validate: async () => null,
  async run(abortSignal, transport, call) {
    const { cmd, timeout } = call.tool.arguments;
    try {
      return { content: await transport.shell(abortSignal, cmd, timeout) };
    } catch(e) {
      if(e instanceof AbortError) throw new ToolError(USER_ABORTED_ERROR_MESSAGE);
      if(e instanceof CommandFailedError) throw new ToolError(e.message);
      throw e;
    }
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;
