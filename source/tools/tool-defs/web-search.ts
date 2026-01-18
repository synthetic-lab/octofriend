import { t } from "structural";
import { attempt, defineTool } from "../common.ts";
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

async function validate() {
  return null;
}

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

export default defineTool<t.GetType<typeof Schema>>(async (_1, _2, config) => {
  const searchConf = await readSearchConfig(config);
  if (searchConf == null) return null;

  return {
    Schema,
    ArgumentsSchema,
    validate,
    async run(abortSignal, _, call) {
      const query = call.arguments.query;
      return attempt(`Web search failed: ${query}`, async () => {
        const response = await fetch(searchConf.url, {
          headers: {
            authorization: `Bearer ${searchConf.key}`,
          },
          method: "POST",
          body: JSON.stringify({
            query,
          }),
          signal: abortSignal,
        });
        const json = await response.json();
        const results = SearchResultsSchema.slice(json);
        return { content: results.results.map(entry => JSON.stringify(entry)).join("\n") };
      });
    },
  };
});
