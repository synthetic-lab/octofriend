import { t } from "structural";
import { TOOL } from "../common.ts";
import { ok } from "../../libocto/result.ts";

export default TOOL.declare({
  name: "explore",
  description: `
Explores a portion of the current workspace in a read-only subagent. Use this when finding the
relevant files, symbols, or conventions would otherwise require a long sequence of filesystem
searches and file reads. The subagent can read files but cannot modify anything, ask the user
questions, or run arbitrary commands.

Pass a self-contained task: include the exact question to answer, any relevant starting points,
and the format you want back.

Be precise: include exactly what you want, and ideas of reasonable stopping points, in your task to
the subagent. The subagent will autonomously run until it finishes what it believes your task is,
so be specific so it doesn't run forever or give you too much information!
`.trim(),
  ArgumentsSchema: t.subtype({
    task: t.str.comment("A complete, self-contained exploration task"),
  }),
  subagents: ["explore"] as const,
}).define(async () => ({
  async run({ toolCall }) {
    return ok({
      type: "invoke-subagent",
      name: "explore",
      message: [{ type: "text", content: toolCall.parsed.arguments.task }],
    });
  },
}));
