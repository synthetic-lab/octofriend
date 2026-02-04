import { t } from "structural";
import { defineTool, attempt } from "../common.ts";
import * as logger from "../../logger.ts";

export const ArgumentsSchema = t.subtype({
  content: t.str.comment("The implementation plan content to write"),
});

const Schema = t
  .subtype({
    name: t.value("write-plan"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "Writes content to the plan file (only available when called with a non-null planFilePath, typically in plan mode)",
  );

export default defineTool<t.GetType<typeof Schema>>(
  async (signal, transport, config, planFilePath) => {
    if (!planFilePath) {
      logger.log("verbose", "write-plan tool not loaded: planFilePath is not set");
      return null;
    }

    return {
      Schema,
      ArgumentsSchema,
      async validate() {
        return null;
      },
      async run(signal, transport, call) {
        const { content } = call.arguments;
        return attempt(`Failed to write plan file ${planFilePath}`, async () => {
          await transport.writeFile(signal, planFilePath, content);
          return {
            content,
            lines: content.split("\n").length,
          };
        });
      },
    };
  },
);
