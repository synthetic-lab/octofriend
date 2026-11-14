import { t } from "structural";
import { TOOL_BUILDER } from "../tool-def.ts";
import { ok, attempt } from "../../result.ts";

export type ResolvedSearchConfig = {
  url: string;
  key: string;
};

export type WebSearchData = {
  searchConfig: ResolvedSearchConfig | null;
};

const SearchResultsSchema = t.subtype({
  results: t.array(
    t.subtype({
      url: t.str,
      title: t.optional(t.str.or(t.nil)),
      highlights: t.array(t.str),
      published: t.optional(t.str.or(t.nil)),
    }),
  ),
});

export default TOOL_BUILDER.withData<WebSearchData>()
  .declare({
    name: "web-search",
    description: `
Searches the web. Use this to find information you're not sure about, to look up documentation,
or to find data that was created after your training knowledge date cutoff.
`.trim(),
    ArgumentsSchema: t.subtype({
      query: t.str.comment("The search query"),
    }),
  })
  .define(async ({ data }) => {
    const searchConf = data.searchConfig;
    if (searchConf == null) return null;

    return {
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
          const content = results.results.map(entry => JSON.stringify(entry)).join("\n");
          return ok({
            type: "output",
            content: [{ type: "text", content }],
          });
        });
      },
    };
  });
