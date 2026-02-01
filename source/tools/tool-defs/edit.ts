/**
 * Plan Mode Tool Pattern:
 *
 * Tools that mutate the codebase check planFilePath first.
 * If planFilePath is non-null, we're in plan mode and should return
 * a placeholder tool that returns PLAN_MODE_MESSAGE instead of
 * performing the mutation. This prevents accidental edits during
 * planning while still keeping the schema available for the LLM.
 */

import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import {
  ToolError,
  attemptUntrackedRead,
  defineTool,
  createPlanModeToolResult,
} from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";

// Construct the intersection manually, since OpenAI and Anthropic can't handle top-level allOf(...)
const DiffParts = {
  search: t.str.comment(`
    The search string to replace. Must EXACTLY match the text you intend to replace, including
    whitespace, punctuation, etc. Make sure to give a few lines of context above and below so you
    don't accidentally replace a different matching substring in the same file.
  `),
  replace: t.str.comment("The string you want to insert into the file"),
};
export const ArgumentsSchema = t
  .subtype({
    filePath: t.str.comment("The path to the file"),
    ...DiffParts,
  })
  .comment(
    "Applies a search/replace edit to a file. This should be your default tool to edit existing files.",
  );
export const DiffEditSchema = t.subtype(DiffParts);

export const Schema = t.subtype({
  name: t.value("edit"),
  arguments: ArgumentsSchema,
});

export default defineTool<t.GetType<typeof Schema>>(
  async (_signal, _transport, _config, planFilePath) => {
    // If in plan mode, return a tool that shows the plan mode message
    if (planFilePath) {
      return {
        Schema,
        ArgumentsSchema,
        validate: async () => null,
        run: async () => createPlanModeToolResult(),
      };
    }

    return {
      Schema,
      ArgumentsSchema,
      validate,
      async run(signal, transport, call) {
        const { filePath } = call.arguments;
        const diff = call.arguments;
        await fileTracker.assertCanEdit(transport, signal, filePath);

        const file = await attemptUntrackedRead(transport, signal, filePath);
        const replaced = runEdit({
          path: filePath,
          file,
          diff,
        });
        await fileTracker.write(transport, signal, filePath, replaced);
        return {
          content: "",
        };
      },
    };
  },
);

async function validate(
  signal: AbortSignal,
  transport: Transport,
  toolCall: t.GetType<typeof Schema>,
) {
  await fileTracker.assertCanEdit(transport, signal, toolCall.arguments.filePath);
  const file = await attemptUntrackedRead(transport, signal, toolCall.arguments.filePath);
  return validateDiff({ file, diff: toolCall.arguments, path: toolCall.arguments.filePath });
}

function runEdit({
  path,
  file,
  diff,
}: {
  path: string;
  file: string;
  diff: t.GetType<typeof ArgumentsSchema>;
}): string {
  validateDiff({ path, file, diff });
  return file.replace(diff.search, diff.replace);
}

function validateDiff({
  path,
  file,
  diff,
}: {
  path: string;
  file: string;
  diff: t.GetType<typeof ArgumentsSchema>;
}) {
  if (!file.includes(diff.search)) {
    throw new ToolError(
      `
Could not find search string in file ${path}: ${diff.search}
This is likely an error in your formatting. The search string must EXACTLY match, including
whitespace and punctuation.
`.trim(),
    );
  }
  return null;
}
