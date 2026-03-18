import fs from "fs/promises";
import { LlmIR, TrajectoryOutputIR, CompactionCheckpoint, ToolCallRequest } from "../ir/llm-ir.ts";
import { QuotaData } from "../utils/quota.ts";
import { Config, ModelConfig } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "../compilers/run.ts";
import { generateCompactionSummary, shouldAutoCompactHistory } from "../compilers/autocompact.ts";
import { validateTool, ToolError } from "../tools/index.ts";
import { FileOutdatedError, fileTracker } from "../tools/file-tracker.ts";
import { autofixEdit } from "../compilers/autofix.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";
import { makeAutofixJson } from "../compilers/autofix.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { loadTools } from "../tools/index.ts";

type AllTokenTypes = "reasoning" | "content" | "tool";

type AssistantBuffer<AllowedType extends string> = {
  [K in AllowedType]?: string;
};
type AssistantDelta<AllowedType extends string> = {
  value: string;
  type: AllowedType;
};

type CompactionType = {
  checkpoint: CompactionCheckpoint;
};

// TODO: compaction actually shouldn't allow for tools, so run() should be modified to not emit
// tokens of type `tool` if no tools are given. (In practice it already doesn't emit them, it just
// requires typesystem shenanigans.)
type AutocompactionStream = {
  type: "autocompaction-stream";
  buffer: AssistantBuffer<AllTokenTypes>;
  delta: AssistantDelta<AllTokenTypes>;
};

export type StateEvents = {
  startResponse: null;
  responseProgress: {
    buffer: AssistantBuffer<AllTokenTypes>;
    delta: AssistantDelta<AllTokenTypes>;
  };
  startCompaction: null;
  compactionProgress: AutocompactionStream;
  compactionParsed: CompactionType;
  autofixingJson: null;
  autofixingDiff: null;
  retryTool: {
    irs: TrajectoryOutputIR[];
  };
  onQuotaUpdated: QuotaData;
};

export type AnyState = keyof StateEvents;

type Finish = {
  type: "finish";
  irs: TrajectoryOutputIR[];
  reason:
    | {
        type: "abort";
      }
    | {
        type: "needs-response";
      }
    | {
        type: "request-tool";
        toolCalls: ToolCallRequest[];
      }
    | {
        type: "request-error";
        requestError: string;
        curl: string;
      };
};

/*
 * Given some LLM IR, it runs the next arc of the trajectory until one of the finish reasons defined
 * above is hit.
 */
export async function trajectoryArc({
  apiKey,
  model,
  messages,
  config,
  transport,
  abortSignal,
  handler,
}: {
  apiKey: string;
  model: ModelConfig;
  messages: LlmIR[];
  config: Config;
  transport: Transport;
  abortSignal: AbortSignal;
  handler: {
    [K in AnyState]: (state: StateEvents[K]) => void;
  };
}): Promise<Finish> {
  if (abortSignal.aborted) return abort([]);

  const messagesCopy = [...messages];
  const autofixJson = makeAutofixJson(config);
  let irs: TrajectoryOutputIR[] = [];
  const tools = await loadTools(transport, abortSignal, config);

  const parsedCompaction = await maybeAutocompact({
    apiKey,
    model,
    abortSignal,
    autofixJson,
    messages: messagesCopy,
    handler: {
      startCompaction: () => handler.startCompaction(null),
      compactionProgress: stream => handler.compactionProgress(stream),
    },
  });

  if (parsedCompaction) {
    handler.compactionParsed(parsedCompaction);
    messagesCopy.push(parsedCompaction.checkpoint);
    irs.push(parsedCompaction.checkpoint);
  }
  if (abortSignal.aborted) return abort([]);

  handler.startResponse(null);

  let buffer: AssistantBuffer<AllTokenTypes> = {};
  const result = await run({
    apiKey,
    model,
    autofixJson,
    abortSignal,
    tools,
    messages: messagesCopy,
    handlers: {
      onTokens: (tokens, type) => {
        if (!buffer[type]) buffer[type] = "";
        buffer[type] += tokens;
        handler.responseProgress({
          buffer,
          delta: { type, value: tokens },
        });
      },
      onAutofixJson: () => {
        handler.autofixingJson(null);
      },
      onQuotaUpdated: quota => handler.onQuotaUpdated(quota),
    },
    systemPrompt: async () => {
      return systemPrompt({
        config,
        transport,
        tools,
        signal: abortSignal,
      });
    },
  });

  function maybeBufferedMessage(): TrajectoryOutputIR[] {
    if (buffer.content || buffer.reasoning || buffer.tool) {
      return [
        ...irs,
        {
          role: "assistant",
          content: buffer.content || "",
          reasoningContent: buffer.reasoning,
          tokenUsage: 0,
          outputTokens: 0,
        },
      ];
    }
    return [];
  }

  if (abortSignal.aborted) return abort(maybeBufferedMessage());

  if (!result.success) {
    return {
      type: "finish",
      irs: maybeBufferedMessage(),
      reason: {
        type: "request-error",
        requestError: result.requestError,
        curl: result.curl,
      },
    };
  }

  if (result.output.length === 0) {
    return {
      type: "finish",
      irs: maybeBufferedMessage(),
      reason: {
        type: "request-error",
        requestError: "No response from backend",
        curl: result.curl,
      },
    };
  }

  irs = [...irs, ...result.output];
  let lastIr = result.output[result.output.length - 1];

  // Retry malformed tool calls
  if (lastIr.role === "tool-malformed") {
    handler.retryTool({ irs });
    const retried = await trajectoryArc({
      apiKey,
      model,
      config,
      transport,
      abortSignal,
      messages: messagesCopy.concat(irs),
      handler,
    });

    return {
      type: "finish",
      irs: [...irs, ...retried.irs],
      reason: retried.reason,
    };
  }

  const { toolCalls } = lastIr;

  if (!toolCalls || toolCalls.length === 0) {
    return {
      type: "finish",
      reason: {
        type: "needs-response",
      },
      irs,
    };
  }

  // Validate all tools (parallel or sequential based on config)
  const parallelExecution = config.parallelToolExecution?.enabled ?? false;
  const maxConcurrency = config.parallelToolExecution?.maxConcurrency ?? 5;

  const validationResults = await validateTools(
    toolCalls,
    abortSignal,
    transport,
    tools,
    config,
    parallelExecution,
    maxConcurrency,
  );

  // Check if any validation failed
  const errors = validationResults.filter(r => r.status === "error");
  if (errors.length > 0) {
    // For now, handle just the first error (more complex error handling TBD)
    const firstError = errors[0];
    const toolCall = firstError.toolCall;
    const e = firstError.error;

    if (e instanceof FileOutdatedError) {
      const errorIrs: TrajectoryOutputIR = await tryTransformFileOutdatedError(
        abortSignal,
        transport,
        toolCall,
        e,
      );
      const retryIrs = [...irs, errorIrs];
      handler.retryTool({ irs: retryIrs });
      const retried = await trajectoryArc({
        apiKey,
        model,
        config,
        transport,
        abortSignal,
        messages: messagesCopy.concat(retryIrs),
        handler,
      });
      return {
        type: "finish",
        irs: [...irs, ...retried.irs],
        reason: retried.reason,
      };
    }

    if (!(e instanceof ToolError)) throw e;

    // Try autofix for edit tool
    const fn = toolCall.function;
    if (fn.name === "edit") {
      handler.autofixingDiff(null);
      const path = fn.arguments.filePath;
      try {
        const file = await fs.readFile(path, "utf8");
        const fix = await autofixEdit(config, file, fn.arguments, abortSignal);

        if (abortSignal.aborted) {
          return abort([
            ...irs.slice(0, -1),
            {
              role: "tool-error",
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.function.name,
              error: e.message,
            },
          ]);
        }

        if (fix) {
          await validateTool(
            abortSignal,
            transport,
            tools,
            {
              name: "edit",
              arguments: fix,
            },
            config,
          );
          fn.arguments = {
            ...fn.arguments,
            ...fix,
          };
        }
      } catch {}
    }

    const retryIrs = [
      ...irs,
      {
        role: "tool-error" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.function.name,
        error: e.message,
      },
    ];
    handler.retryTool({ irs: retryIrs });
    const retried = await trajectoryArc({
      apiKey,
      model,
      config,
      transport,
      abortSignal,
      messages: messagesCopy.concat(retryIrs),
      handler,
    });
    return {
      type: "finish",
      irs: [...irs, ...retried.irs],
      reason: retried.reason,
    };
  }

  // All tools validated - return them for execution
  return {
    type: "finish",
    reason: {
      type: "request-tool",
      toolCalls: validationResults.map(
        r => (r as { status: "ok"; toolCall: ToolCallRequest }).toolCall,
      ),
    },
    irs,
  };
}

async function maybeAutocompact({
  apiKey,
  model,
  messages,
  abortSignal,
  handler,
  autofixJson,
}: {
  apiKey: string;
  model: ModelConfig;
  messages: LlmIR[];
  abortSignal: AbortSignal;
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  handler: {
    startCompaction: () => void;
    compactionProgress: (stream: AutocompactionStream) => void;
  };
}): Promise<CompactionType | null> {
  if (!shouldAutoCompactHistory(model, messages)) return null;

  handler.startCompaction();

  const buffer: AssistantBuffer<AllTokenTypes> = {};
  const checkpointSummary = await generateCompactionSummary({
    apiKey,
    model,
    messages,
    abortSignal,
    autofixJson,
    handlers: {
      onTokens: (tokens, type) => {
        if (!buffer[type]) buffer[type] = "";
        buffer[type] += tokens;
        handler.compactionProgress({
          type: "autocompaction-stream",
          buffer,
          delta: { value: tokens, type },
        });
      },
      onAutofixJson: () => {},
    },
  });

  if (checkpointSummary == null) return null;

  return {
    checkpoint: {
      role: "compaction-checkpoint",
      summary: checkpointSummary,
    },
  };
}

function abort(irs: TrajectoryOutputIR[]): Finish {
  return {
    type: "finish",
    reason: { type: "abort" },
    irs,
  };
}

async function validateTools(
  toolCalls: ToolCallRequest[],
  abortSignal: AbortSignal,
  transport: Transport,
  tools: Awaited<ReturnType<typeof loadTools>>,
  config: Config,
  parallel: boolean,
  maxConcurrency: number,
): Promise<
  Array<
    | { status: "ok"; toolCall: ToolCallRequest }
    | { status: "error"; toolCall: ToolCallRequest; error: Error }
  >
> {
  const validateSingle = async (toolCall: ToolCallRequest) => {
    try {
      await validateTool(abortSignal, transport, tools, toolCall.function, config);
      return { status: "ok" as const, toolCall };
    } catch (e) {
      if (e instanceof FileOutdatedError) {
        return { status: "error" as const, toolCall, error: e };
      }
      return { status: "error" as const, toolCall, error: e as Error };
    }
  };

  if (!parallel) {
    // Sequential validation
    const results: Array<
      | { status: "ok"; toolCall: ToolCallRequest }
      | { status: "error"; toolCall: ToolCallRequest; error: Error }
    > = [];
    for (const toolCall of toolCalls) {
      results.push(await validateSingle(toolCall));
    }
    return results;
  }

  // Parallel validation with concurrency limit
  const chunks: ToolCallRequest[][] = [];
  for (let i = 0; i < toolCalls.length; i += maxConcurrency) {
    chunks.push(toolCalls.slice(i, i + maxConcurrency));
  }

  const results: Array<
    | { status: "ok"; toolCall: ToolCallRequest }
    | { status: "error"; toolCall: ToolCallRequest; error: Error }
  > = [];

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(validateSingle));
    results.push(...chunkResults);

    // Check for abort after each chunk
    if (abortSignal.aborted) {
      throw new Error("Aborted");
    }
  }

  return results;
}

async function tryTransformFileOutdatedError(
  abortSignal: AbortSignal,
  transport: Transport,
  toolCall: ToolCallRequest,
  e: FileOutdatedError,
): Promise<TrajectoryOutputIR> {
  const absolutePath = await transport.resolvePath(abortSignal, e.filePath);

  try {
    await fileTracker.readUntracked(transport, abortSignal, absolutePath);
    return {
      role: "file-outdated",
      toolCall,
      error:
        "File could not be updated because it was modified after being last read. Please read the file again before modifying it.",
    };
  } catch {
    return {
      role: "file-unreadable",
      path: e.filePath,
      toolCall,
      error: `File ${e.filePath} could not be read. Has it been deleted?`,
    };
  }
}
