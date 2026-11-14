import { t } from "structural";
import { USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { TOOL_BUILDER } from "../tool-def.ts";
import { compile } from "html-to-text";
import { AbortError } from "../../transport.ts";
import { ok, err, toErrString } from "../../result.ts";

const converter = compile({
  wordwrap: 130,
});

export default TOOL_BUILDER.withData<{}>()
  .declare({
    name: "fetch",
    description: "Fetches web resources via HTTP/HTTPS. Prefer this to bash-isms like curl/wget",
    ArgumentsSchema: t.subtype({
      url: t.str.comment("Full url to fetch, e.g. https://..."),
      includeMarkup: t.optional(
        t.bool.comment(
          `Include the HTML markup? Defaults to false. By default or when set to false, markup will be
stripped and converted to plain text. Prefer markup stripping, and only set this to true if the
output is confusing: otherwise you may download a massive amount of data`,
        ),
      ),
    }),
  })
  .define(async () => ({
    async run({ signal, toolCall, model }) {
      const { url, includeMarkup } = toolCall.parsed.arguments;
      try {
        const response = await fetch(url, { signal });
        const full = await response.text();
        const text = includeMarkup ? full : converter(full);

        if (!response.ok) {
          if (response.status === 403) {
            return err(
              `Authorization failed: status code ${403}\n${text}\nThis appears to have failed authorization, ask the user for help: they may be able to read the URL and copy/paste for you.`,
            );
          }
          return err(`Request failed: ${text}`);
        }

        const contextWindow = model.contextWindow;
        if (text.length > contextWindow) {
          return err(`Web content too large: ${text.length} bytes (max: ${contextWindow} bytes)`);
        }

        return ok({
          type: "output",
          content: [{ type: "text", content: text }],
        });
      } catch (e) {
        if (e instanceof AbortError || signal.aborted) {
          return err(USER_ABORTED_ERROR_MESSAGE);
        }
        return toErrString(e);
      }
    },
  }));
