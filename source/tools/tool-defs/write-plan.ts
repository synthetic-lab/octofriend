import { t } from "structural";
import { defineTool, attempt } from "../common.ts";

export const ArgumentsSchema = t.subtype({
  content: t.str.comment("The implementation plan content to write"),
});

const Schema = t
  .subtype({
    name: t.value("write-plan"),
    arguments: ArgumentsSchema,
  })
  .comment("Writes content to the plan file (only available in plan mode)");

export default defineTool<t.GetType<typeof Schema>>(
  async (signal, transport, config, planFilePath) => {
    // Only available when planFilePath is set (i.e., in plan mode)
    if (!planFilePath) {
      throw new Error("write-plan tool is not available outside of plan mode");
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
