import { t } from "structural";
import { ToolError, ToolDef } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { compile } from "html-to-text";

const converter = compile({
  wordwrap: 130,
});

const ArgumentsSchema = t.subtype({
   url: t.str.comment("Full url to fetch, e.g. https://..."),
   includeMarkup: t.optional(t.bool.comment(
`Include the HTML markup? Defaults to false. By default or when set to false, markup will be
stripped and converted to plain text. Prefer markup stripping, and only set this to true if the
output is confusing: otherwise you may download a massive amount of data`
   )),
});
const Schema = t.subtype({
 name: t.value("fetch"),
 arguments: ArgumentsSchema,
}).comment("Fetches web resources via HTTP/HTTPS. Prefer this to bash-isms like curl/wget");

export default {
  Schema, ArgumentsSchema, validate,
  async run(call, config, modelOverride) {
    const { url, includeMarkup } = call.tool.arguments;
    const response = await fetch(url);
    const full = await response.text();
    const text = includeMarkup ? full : converter(full);
    const { context } = getModelFromConfig(config, modelOverride);
    if(text.length > context) {
      throw new ToolError(
        `Web content too large: ${text.length} bytes (max: ${context} bytes)`
      );
    }

    if(!response.ok) {
      if(response.status === 403) {
        throw new ToolError(`Error: ${response.status}\n${text}\nThis appears to have failed authorization, ask the user for help: they may be able to read the URL and copy/paste for you.`);
      }
      throw new ToolError(`Error: ${response.status}\n${text}`);
    }

    return text;
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

export async function validate(_: t.GetType<typeof Schema>) {
  return null;
}
