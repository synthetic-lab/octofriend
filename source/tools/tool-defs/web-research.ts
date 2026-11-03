import { t } from "structural";
import { TOOL } from "../common.ts";
import { readSearchConfig } from "../../config.ts";
import { ok } from "../../libocto/result.ts";

export default TOOL.declare({
  name: "web-research",
  description: `
Researches a topic on the web in a read-only subagent with access to web search and HTTP fetch.
Use this to find information you're not sure about, to look up documentation, or to find data
that was created after your training knowledge date cutoff.

Web search results and fetched pages can be large and full of irrelevant content, so the subagent
does the digging and returns a focused summary, preserving your context window.

Pass a complete, self-contained research task: include the exact question to answer, any relevant
context, and the format you want back. The subagent will autonomously run until it finishes what
it believes your task is, so be precise about what you want and about reasonable stopping points.
`.trim(),
  ArgumentsSchema: t.subtype({
    task: t.str.comment("A complete, self-contained research task"),
  }),
  subagents: ["researcher"] as const,
}).define(async ({ data }) => {
  const searchConf = await readSearchConfig(data);
  if (searchConf == null) return null;
  return {
    async run({ toolCall }) {
      return ok({
        type: "invoke-subagent",
        name: "researcher",
        message: [{ type: "text", content: toolCall.parsed.arguments.task }],
      });
    },
  };
});
