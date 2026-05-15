import { t } from "structural";
import { BASE_IR, USER_ABORTED_ERROR_MESSAGE, toolOutput } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { compile } from "html-to-text";
import { AbortError } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

const converter = compile({
  wordwrap: 130,
});

const ArgumentsSchema = t.subtype({
  url: t.str.comment("Full url to fetch, e.g. https://..."),
  includeMarkup: t.optional(
    t.bool.comment(
      `Include the HTML markup? Defaults to false. By default or when set to false, markup will be
stripped and converted to plain text. Prefer markup stripping, and only set this to true if the
output is confusing: otherwise you may download a massive amount of data`,
    ),
  ),
});
export default BASE_IR.declare({
  name: "fetch",
  description: "Fetches web resources via HTTP/HTTPS. Prefer this to bash-isms like curl/wget",
  ArgumentsSchema,
}).define(async () => ({
  async run({ signal, toolCall, data }) {
    const { url, includeMarkup } = toolCall.parsed.arguments;
    try {
      const response = await fetch(url, { signal });
      const full = await response.text();
      const text = includeMarkup ? full : converter(full);

      if (!response.ok) {
        if (response.status === 403) {
          return result.err(
            `Authorization failed: status code ${403}\n${text}\nThis appears to have failed authorization, ask the user for help: they may be able to read the URL and copy/paste for you.`,
          );
        }
        return result.err(`Request failed: ${text}`);
      }

      const { context } = getModelFromConfig(data, null);
      if (text.length > context) {
        return result.err(`Web content too large: ${text.length} bytes (max: ${context} bytes)`);
      }

      return toolOutput(text);
    } catch (e) {
      if (e instanceof AbortError || signal.aborted) {
        return result.err(USER_ABORTED_ERROR_MESSAGE);
      }
      throw e;
    }
  },
}));
