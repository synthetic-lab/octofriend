import { t } from "structural";
import { ToolError, ToolDef } from "../common.ts";

const ArgumentsSchema = t.subtype({
   url: t.str.comment("Full url to fetch, e.g. https://..."),
});
const Schema = t.subtype({
 name: t.value("fetch"),
 arguments: ArgumentsSchema,
}).comment("Fetches web resources via HTTP/HTTPS. Prefer this to bash-isms like curl/wget");

export default {
  Schema, ArgumentsSchema, validate,
  async run(call) {
    const { url } = call.tool.arguments;
    const response = await fetch(url);
    const text = await response.text();
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
