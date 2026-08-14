import { t } from "structural";
import { TOOL } from "../common.ts";
import { LocalTransport } from "../../transports/local.ts";
import { ok, err, toErrString } from "../../libocto/result.ts";
import { unionAll } from "../../types.ts";
import {
  BackgroundProcessError,
  BackgroundProcessState,
  backgroundProcesses,
} from "../../background-processes.ts";

export default TOOL.declare({
  name: "background-process",
  description: `
Spawns, inspects, and cleans up background processes (e.g. dev servers, file
watchers) on the local machine. Use the shell tool for foreground commands
instead: background processes run detached, so you must poll their state and
read their output through this tool.

Actions:

- spawn: start a new background process. Requires "command" and "name".
  The command runs with /bin/sh (POSIX shell — no bash-isms) in the current
  working directory, in its own process group. Don't end the command with
  "&": the process already runs in the background.
- status: report the state of a process by "name": running/exited/killed,
  pid, exit code, and how long ago it started.
- output: read the tail of a process's combined stdout/stderr by "name".
- list: report the state of every tracked background process.
- kill: terminate a process (and its whole process group) by "name".
  SIGTERM first, then SIGKILL.

By default processes are bound to this session and are killed automatically
when Octo exits. Spawn with global: true to let the process survive Octo
restarts: its state and logs are persisted on disk so a later Octo session
can still check its status, read its output, and kill it.
`.trim(),
  ArgumentsSchema: t.subtype({
    action: unionAll([
      t.value("spawn"),
      t.value("status"),
      t.value("output"),
      t.value("list"),
      t.value("kill"),
    ]).comment("What to do: spawn, status, output, list, or kill."),
    name: t.optional(
      t.str.comment(
        "A human-readable display name for the process. Required by every action except list. Letters, digits, '.', '-', and '_' only.",
      ),
    ),
    command: t.optional(
      t.str.comment(
        "The terminal command to run (e.g. `bun run dev`). Required when action is spawn.",
      ),
    ),
    global: t.optional(
      t.bool.comment(
        "If true, the process survives even if you restart Octo. If false (the default), it is bound to your current session.",
      ),
    ),
    lines: t.optional(
      t.num.comment("For output: the number of trailing lines to return (default: all that fit)."),
    ),
  }),
}).define(async function ({ transport }) {
  // Spawning happens on Octo's machine; in Docker sandboxes that's the host,
  // which would break containment. Only expose this tool when it's not.
  if (!(transport instanceof LocalTransport)) return null;

  return {
    async run({ transport, toolCall }) {
      const args = toolCall.parsed.arguments;
      try {
        switch (args.action) {
          case "spawn": {
            if (!args.name) return err(`"name" is required when action is spawn.`);
            if (!args.command) return err(`"command" is required when action is spawn.`);
            const state = await backgroundProcesses.spawn({
              name: args.name,
              command: args.command,
              cwd: transport.cwd,
              global: args.global,
            });
            return ok(output(`Spawned background process.\n${renderState(state)}`));
          }

          case "status": {
            const name = requireName(args.name, "status");
            if (name.success === false) return name;
            return ok(output(renderState(await backgroundProcesses.status(name.data))));
          }

          case "output": {
            const name = requireName(args.name, "output");
            if (name.success === false) return name;
            const result = await backgroundProcesses.output(name.data, { lines: args.lines });
            return ok(
              output(`${renderState(result.state)}\n--- output tail ---\n${result.output}`),
            );
          }

          case "list": {
            const states = await backgroundProcesses.list();
            const text =
              states.length === 0
                ? "No background processes are currently tracked."
                : states.map(renderState).join("\n\n");
            return ok(output(text));
          }

          case "kill": {
            const name = requireName(args.name, "kill");
            if (name.success === false) return name;
            const state = await backgroundProcesses.kill(name.data);
            return ok(output(`${renderState(state)}\nProcess terminated.`));
          }
        }
      } catch (e) {
        if (e instanceof BackgroundProcessError) return err(e.message);
        return toErrString(e);
      }
    },
  };
});

function requireName(name: string | undefined, action: string) {
  if (name) return ok(name);
  return err(`"name" is required when action is ${action}.`);
}

function renderState(state: BackgroundProcessState): string {
  return [
    `name: ${state.name}`,
    `status: ${state.status}`,
    `pid: ${state.pid ?? "unknown"}`,
    `exit code: ${state.exitCode ?? "n/a"}`,
    `started: ${state.startedAt}`,
    `global: ${state.global}`,
    `cwd: ${state.cwd}`,
    `command: ${state.command}`,
  ].join("\n");
}

function output(content: string) {
  return { type: "output" as const, content: [{ type: "text" as const, content }] };
}
