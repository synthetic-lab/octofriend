import { t } from "structural";
import { defineTool, ToolResult } from "../common.ts";
import { loadTools, runTool } from "../index.ts";

const CallSchema = t.subtype({
  name: t.str.comment("Name of the tool to call"),
  arguments: t.any.comment("Arguments to pass to the tool"),
});

const ArgumentsSchema = t.subtype({
  calls: t.array(CallSchema).comment("Array of tool calls to execute"),
  parallel: t.optional(t.bool.comment("Whether to execute calls in parallel (default: false)")),
});

const Schema = t
  .subtype({
    name: t.value("batch"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "PREFER: When you need to read, list, or fetch multiple independent resources, always use this batch tool instead of calling tools one at a time. Execute multiple tool calls in a single turn with parallel=true for concurrent execution. Results are returned in compact TOON format (~40% fewer tokens than JSON). Each sub-tool handles its own confirmation.",
  );

type BatchCall = {
  name: string;
  arguments: unknown;
};

type BatchResult = {
  tool: string;
  success: boolean;
  content?: string;
  error?: string;
};

export default defineTool<t.GetType<typeof Schema>>(async () => ({
  Schema,
  ArgumentsSchema,

  async validate() {
    // Validation is deferred to sub-tools at execution time
    return null;
  },

  async run(abortSignal, transport, call, config, modelOverride) {
    const { calls, parallel = false } = call.arguments;

    // Load tools once for all sub-calls
    const loadedTools = await loadTools(transport, abortSignal, config);

    const results: BatchResult[] = [];
    let successCount = 0;
    let failCount = 0;

    if (parallel) {
      // Execute in parallel using Promise.allSettled
      const promises = calls.map(async (subCall: BatchCall) => {
        try {
          const result = await runTool(
            abortSignal,
            transport,
            loadedTools,
            { name: subCall.name, arguments: subCall.arguments } as any,
            config,
            modelOverride,
          );
          return {
            tool: subCall.name,
            success: true,
            content: result.content,
          };
        } catch (error) {
          return {
            tool: subCall.name,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const settled = await Promise.allSettled(promises);
      for (const result of settled) {
        if (result.status === "fulfilled") {
          results.push(result.value);
          if (result.value.success) {
            successCount++;
          } else {
            failCount++;
          }
        } else {
          // This shouldn't happen since we catch in the promise, but handle defensively
          results.push({
            tool: "unknown",
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
          failCount++;
        }
      }
    } else {
      // Execute sequentially
      for (const subCall of calls as BatchCall[]) {
        try {
          const result = await runTool(
            abortSignal,
            transport,
            loadedTools,
            { name: subCall.name, arguments: subCall.arguments } as any,
            config,
            modelOverride,
          );
          results.push({
            tool: subCall.name,
            success: true,
            content: result.content,
          });
          successCount++;
        } catch (error) {
          results.push({
            tool: subCall.name,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          failCount++;
        }
      }
    }

    // If ALL sub-tools failed, return an error for retry
    if (failCount > 0 && successCount === 0) {
      return {
        content: `Batch execution failed: all ${failCount} tool call(s) failed. Errors: ${results
          .map(r => `${r.tool}: ${r.error}`)
          .join("; ")}`,
      };
    }

    // Serialize results as TOON
    const toonContent = toToon(results);

    return {
      content: toonContent,
      batchResults: results,
      parallel,
      successCount,
      failCount,
    } as unknown as ToolResult;
  },
}));

function toToon(
  results: Array<{ tool: string; success: boolean; content?: string; error?: string }>,
): string {
  const header = "@results[tool,success,content,error]";
  const rows = results.map(r =>
    [
      r.tool,
      r.success,
      (r.content ?? "").replace(/\n/g, "\\n").replace(/\|/g, "\\|"),
      r.error ?? "",
    ].join("|"),
  );
  return [header, ...rows].join("\n");
}
