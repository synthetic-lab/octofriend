import { quote } from "shell-quote";
import { t } from "structural";
import { ToolError, defineTool, USER_ABORTED_ERROR_MESSAGE, autoparse } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { AbortError, CommandFailedError } from "../../transports/transport-common.ts";
import { estimateTokens } from "../../ir/count-ir-tokens.ts";

const ArgumentsSchema = t.subtype({
  cwd: t.optional(t.str),
  search: t.partial(
    t.subtype({
      pattern: t.str.comment("The search pattern"),
      path: t.str.comment("Directory or file to search (defaults to cwd)"),
      caseInsensitive: t.bool.comment("Case-insensitive search"),
      context: t.num.comment("Number of context lines around each match"),
      maxResults: t.num.comment("Max number of results to return"),
      timeout: t.num.comment("Timeout in milliseconds (defaults to 30000)"),
    }),
  ),
});

const Schema = t.subtype({
  name: t.value("grep"),
  arguments: ArgumentsSchema,
}).comment(`
Searches file contents using grep. Prefer this to shelling out to \`grep\` directly.
`);

export default defineTool(Schema, ArgumentsSchema, async () => ({
  Schema,
  ArgumentsSchema,
  validate: async () => null,
  ...autoparse(ArgumentsSchema),
  async run(signal, transport, call, config, modelOverride) {
    const { cwd, search } = call.parsed.arguments;
    try {
      const args: string[] = ["-n", "-r"];

      if (search.caseInsensitive) {
        args.push("-i");
      }

      if (search.context !== undefined && search.context > 0) {
        args.push(`-C${search.context}`);
      }

      args.push("--", quote([search.pattern ?? ""]));

      const searchPath = search.path ?? cwd ?? transport.cwd;
      args.push(quote([searchPath]));

      const cmd = `grep ${args.join(" ")}`;
      const timeout = search.timeout ?? 30000;
      const output = await transport.shell(signal, cmd, timeout);

      let results = output.split("\n").filter(line => line.length > 0);

      if (search.maxResults !== undefined && search.maxResults > 0) {
        results = results.slice(0, search.maxResults);
      }

      const text = results.join("\n");
      const { context } = getModelFromConfig(config, modelOverride);
      const tok = estimateTokens(text);
      if (tok > context) {
        throw new ToolError(`Grep content was too large: approx ${tok} tokens returned`);
      }
      return { content: text };
    } catch (e) {
      if (e instanceof AbortError || signal.aborted) {
        throw new ToolError(USER_ABORTED_ERROR_MESSAGE);
      }
      if (e instanceof CommandFailedError) {
        if (e.message.includes("exit code 1")) {
          return { content: "" };
        }
        throw new ToolError(e.message);
      }
      throw e;
    }
  },
}));
