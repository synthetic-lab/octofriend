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
