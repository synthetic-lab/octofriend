import { quote } from "shell-quote";
import { t } from "structural";
import { TOOL, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { AbortError, CommandFailedError } from "../../transports/transport-common.ts";
import { estimateTokens } from "../../ir/count-ir-tokens.ts";
import { ok, err, toErrString } from "../../libocto/result.ts";

export default TOOL.declare({
  name: "grep",
  description: "Searches file contents using grep. Prefer this to shelling out to `grep` directly.",
  ArgumentsSchema: t.subtype({
    pattern: t.str.comment(
      "The search pattern. Internally uses grep with the -E flag (extended regex).",
    ),
    path: t.optional(
      t.str.comment("Directory or file to search in. Defaults to the current working directory."),
    ),
    caseInsensitive: t.optional(t.bool.comment("Case-insensitive search")),
    context: t.optional(t.num.comment("Number of context lines around each match")),
    maxResults: t.optional(t.num.comment("Max number of results to return")),
    timeout: t.optional(t.num.comment("Timeout in milliseconds (defaults to 30000)")),
  }),
}).define(async () => ({
  async run({ signal, transport, toolCall, data }) {
    const search = toolCall.parsed.arguments;
    try {
      const args: string[] = ["-n", "-r", "-E"];

      if (search.caseInsensitive) {
        args.push("-i");
      }

      if (search.context !== undefined && search.context > 0) {
        args.push(`-C${search.context}`);
      }

      args.push("--", quote([search.pattern ?? ""]));

      const searchPath = search.path ?? transport.cwd;
      args.push(quote([searchPath]));

      const cmd = `grep ${args.join(" ")}`;
      const output = await transport.shell(signal, cmd, search.timeout ?? 30000);

      let results = output.split("\n").filter(line => line.length > 0);

      if (search.maxResults !== undefined && search.maxResults > 0) {
        results = results.slice(0, search.maxResults);
      }

      const text = results.join("\n");
      const { context } = getModelFromConfig(data, null);
      const tok = estimateTokens(text);
      if (tok > context) {
        return err(`Grep content was too large: approx ${tok} tokens returned`);
      }
      return ok({
        type: "output",
        content: [{ type: "text", content: text }],
      });
    } catch (e) {
      if (e instanceof AbortError || signal.aborted) {
        return err(USER_ABORTED_ERROR_MESSAGE);
      }
      if (e instanceof CommandFailedError) {
        if (e.exitCode === 1) {
          return ok({
            type: "output",
            content: [{ type: "text", content: "" }],
          });
        }
        return err(e.message);
      }
      return toErrString(e);
    }
  },
}));
