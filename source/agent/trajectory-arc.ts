import fs from "fs/promises";
import { LlmIR, TrajectoryOutputIR, CompactionCheckpoint, ToolCallRequest } from "../ir/llm-ir.ts";
import { Config, ModelConfig } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "../compilers/run.ts";
import { generateCompactionSummary, shouldAutoCompactHistory } from "../compilers/autocompact.ts";
import { validateTool, ToolError, LoadedTools } from "../tools/index.ts";
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
        toolCall: ToolCallRequest;
        toolCalls?: ToolCallRequest[]; // For parallel tool execution
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
  systemPrompt: customSystemPrompt,
  tools,
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
  systemPrompt?: () => Promise<string>;
  tools?: Partial<LoadedTools>;
}): Promise<Finish> {
  if (abortSignal.aborted) return abort([]);

  const messagesCopy = [...messages];
  const autofixJson = makeAutofixJson(config);
  let irs: TrajectoryOutputIR[] = [];
  const loadedTools = tools ?? (await loadTools(transport, abortSignal, config));

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
    tools: loadedTools,
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
    },
    systemPrompt:
      customSystemPrompt ??
      (async () => {
        return systemPrompt({
          config,
          transport,
          tools: loadedTools,
          signal: abortSignal,
        });
      }),
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

  // Check for parallel tool calls first
  const toolCalls = lastIr.toolCalls;
  const singleToolCall = lastIr.toolCall;

  if (!toolCalls && !singleToolCall) {
    return {
      type: "finish",
      reason: {
        type: "needs-response",
      },
      irs,
    };
  }

  // Handle parallel tool calls
  if (toolCalls && toolCalls.length > 0) {
    // Validate all tools first
    for (const tc of toolCalls) {
      try {
        await validateTool(abortSignal, transport, loadedTools, tc.function, config);
      } catch (e) {
        // If validation fails for any tool, return error for that tool
        if (e instanceof FileOutdatedError) {
          const errorIrs: TrajectoryOutputIR = await tryTransformFileOutdatedError(
            abortSignal,
            transport,
            tc,
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
        // For other errors, create a tool error message
        if (e instanceof ToolError) {
          const toolErrorIr: TrajectoryOutputIR = {
            role: "tool-error",
            toolCallId: tc.toolCallId,
            toolName: tc.function.name,
            error: e.message,
          };
          return {
            type: "finish",
            irs: [...irs, toolErrorIr],
            reason: {
              type: "request-tool",
              toolCall: tc,
              toolCalls: toolCalls.filter(t => t.toolCallId !== tc.toolCallId),
            },
          };
        }
        throw e;
      }
    }

    // All tools validated, return them for parallel execution
    return {
      type: "finish",
      reason: {
        type: "request-tool",
        toolCall: toolCalls[0],
        toolCalls: toolCalls,
      },
      irs,
    };
  }

  // Handle single tool call (backward compatibility)
  if (!singleToolCall) {
    return {
      type: "finish",
      reason: {
        type: "needs-response",
      },
      irs,
    };
  }

  try {
    await validateTool(abortSignal, transport, loadedTools, singleToolCall.function, config);
    return {
      type: "finish",
      reason: {
        type: "request-tool",
        toolCall: singleToolCall,
      },
      irs,
    };
  } catch (e) {
    if (e instanceof FileOutdatedError) {
      const errorIrs: TrajectoryOutputIR = await tryTransformFileOutdatedError(
        abortSignal,
        transport,
        singleToolCall,
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

    const fn = singleToolCall.function;
    if (fn.name === "edit") {
      handler.autofixingDiff(null);
      const path = fn.arguments.filePath;
      try {
        const file = await fs.readFile(path, "utf8");
        const fix = await autofixEdit(config, file, fn.arguments, abortSignal);

        // If we aborted the autofix, slice off the messed up tool call and replace it with a failed
        // tool call
        if (abortSignal.aborted) {
          return abort([
            ...irs.slice(0, -1),
            {
              role: "tool-error",
              toolCallId: singleToolCall.toolCallId,
              toolName: singleToolCall.function.name,
              error: e.message,
            },
          ]);
        }

        if (fix) {
          // Validate that the edit applies before marking as fixed
          await validateTool(
            abortSignal,
            transport,
            loadedTools,
            {
              name: "edit",
              arguments: fix,
            },
            config,
          );
          // If we got this far, it's valid: update the state and return
          fn.arguments = {
            ...fn.arguments,
            ...fix,
          };
          return {
            type: "finish",
            reason: {
              type: "request-tool",
              toolCall: singleToolCall,
            },
            irs,
          };
        }
      } catch {}
    }

    const retryIrs = [
      ...irs,
      {
        role: "tool-error" as const,
        toolCallId: singleToolCall.toolCallId,
        toolName: singleToolCall.function.name,
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
