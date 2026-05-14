import { t } from "structural";
import { BASE_IR, attempt, toolOutput } from "../common.ts";
import { readSearchConfig } from "../../config.ts";

const ArgumentsSchema = t.subtype({
  query: t.str.comment("The search query"),
});
const Schema = t
  .subtype({
    name: t.value("web-search"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "Searches the web. Use this to find information you're not sure about, to look up documentation, or to find data that was created after your training knowledge date cutoff.",
  );

const SearchResultsSchema = t.subtype({
  results: t.array(
    t.subtype({
      url: t.str,
      title: t.optional(t.str.or(t.nil)),
      text: t.str,
      published: t.optional(t.str.or(t.nil)),
    }),
  ),
});

export default BASE_IR.dynamicDefineTool(async ({ data }) => {
  const searchConf = await readSearchConfig(data);
  if (searchConf == null) return null;

  return BASE_IR.declare({
    name: "web-search",
    ArgumentsSchema,
  }).define(async () => ({
    async run({ signal, toolCall }) {
      const query = toolCall.parsed.arguments.query;
      return attempt(`Web search failed: ${query}`, async () => {
        const response = await fetch(searchConf.url, {
          headers: {
            authorization: `Bearer ${searchConf.key}`,
          },
          method: "POST",
          body: JSON.stringify({
            query,
          }),
          signal,
        });
        const json = await response.json();
        const results = SearchResultsSchema.slice(json);
        return toolOutput(results.results.map(entry => JSON.stringify(entry)).join("\n"));
      });
    },
  }));
});
