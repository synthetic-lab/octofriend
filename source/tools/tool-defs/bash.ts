import { t } from "structural";
import { spawn } from "child_process";
import { ToolError, ToolDef } from "../common.ts";

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
  async run(_, call) {
    const { cmd, timeout } = call.tool.arguments;
    return new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, {
        cwd: process.cwd(),
        shell: "/bin/bash",
        timeout,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          if(code == null) {
            reject(new ToolError(
`Command timed out.
output: ${output}`));
          }
          else {
            reject(new ToolError(
`Command exited with code: ${code}
output: ${output}`));
          }
        }
      });

      child.on('error', (err) => {
        reject(new ToolError(`Command failed: ${err.message}`));
      });
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;
