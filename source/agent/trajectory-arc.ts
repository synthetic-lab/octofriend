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
    transport,
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
    transport,
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

  let assistantMessage = result.output;
  irs = [...irs, assistantMessage];

  // Retry malformed tool calls
  let malformedRequests = false;
  for (const call of assistantMessage.toolCalls || []) {
    if (call.type === "malformed-request") {
      malformedRequests = true;
      break;
    }
  }

  if (malformedRequests) {
    // Insert tool skips for all of the non-malformed tool call IRs, and ensure the original order
    // is kept in terms of input ordering vs output message ordering
    for (const call of assistantMessage.toolCalls || []) {
      if (call.type === "tool-request") {
        irs.push({
          role: "tool-skip",
          toolCall: call,
          reason: "Another tool call in this batch was malformed, so this tool call was skipped",
        });
      } else {
        const _: "malformed-request" = call.type;
        irs.push({
          role: "tool-malformed",
          malformedRequest: call,
        });
      }
    }

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

  const { toolCalls } = assistantMessage;

  if (toolCalls == null) {
    return {
      type: "finish",
      reason: {
        type: "needs-response",
      },
      irs,
    };
  }

  let retryIrs: TrajectoryOutputIR[] = [];
  const wellformedToolCalls: Array<ToolCallRequest> = [];
  for (const toolCall of toolCalls) {
    if (toolCall.type === "malformed-request") {
      throw new Error(
        "Impossible tool ordering: encountered a malformed tool with no malformed response",
      );
    }
    wellformedToolCalls.push(toolCall);
  }

  // TODO: use Promise.all to do this in parallel
  // Requires changing the signature somewhat; currently we expect that the handlers are called
  // sequentially (i.e. we only autofix one tool at a time), but this would imply we could call the
  // handlers multiple times within a single validation step
  for (const toolCall of wellformedToolCalls) {
    try {
      await validateTool(abortSignal, transport, tools, toolCall.call, config);

      // If we got this far, the tool validated successfully. Proactively push a tool-skip IR for
      // it, in case other tool calls fail to validate (since all tool calls will be skipped if any
      // are invalid).
      retryIrs.push({
        role: "tool-skip",
        toolCall: toolCall,
        reason: "One of your other tool calls was invalid, so no tool calls were run",
      });
    } catch (e) {
      if (e instanceof FileOutdatedError) {
        const errorIr: TrajectoryOutputIR = await tryTransformFileOutdatedError(
          abortSignal,
          transport,
          toolCall,
          e,
        );
        retryIrs = [...retryIrs, errorIr];
        continue;
      }

      if (!(e instanceof ToolError)) throw e;

      const fn = toolCall.call.parsed;
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
                toolCall: toolCall,
                error: e.message,
              },
            ]);
          }

          if (fix) {
            // Validate that the edit applies before marking as fixed
            const fixed = {
              name: "edit",
              arguments: {
                ...fn.arguments,
                ...fix,
              },
            } as const;

            await validateTool(
              abortSignal,
              transport,
              tools,
              {
                original: fixed,
                parsed: fixed,
              },
              config,
            );

            // If we got this far, it's valid: update the state and keep going
            fn.arguments = {
              ...fn.arguments,
              ...fix,
            };

            // Push a tool skip proactively
            retryIrs.push({
              role: "tool-skip",
              toolCall: toolCall,
              reason: "One of your other tool calls was invalid, so no tool calls were run",
            });

            continue;
          }
        } catch {}
      }

      retryIrs = [
        ...retryIrs,
        {
          role: "tool-error" as const,
          toolCall: toolCall,
          error: e.message,
        },
      ];
      continue;
    }
  }

  // If you have any IRs that need to be retried, retry them
  let needsRetry = false;
  for (const ir of retryIrs) {
    if (ir.role !== "tool-skip") {
      needsRetry = true;
      break;
    }
  }
  if (needsRetry) {
    const fullRetryTrajectory = [...irs, ...retryIrs];
    handler.retryTool({ irs: fullRetryTrajectory });
    const retried = await trajectoryArc({
      apiKey,
      model,
      config,
      transport,
      abortSignal,
      messages: messagesCopy.concat(fullRetryTrajectory),
      handler,
    });
    return {
      type: "finish",
      irs: [...fullRetryTrajectory, ...retried.irs],
      reason: retried.reason,
    };
  }

  // Got this far? Everything validated. Return the tool calls
  return {
    type: "finish",
    reason: {
      type: "request-tool",
      toolCalls: wellformedToolCalls,
    },
    irs,
  };
}

async function maybeAutocompact({
  apiKey,
  model,
  messages,
  abortSignal,
  transport,
  handler,
  autofixJson,
}: {
  apiKey: string;
  model: ModelConfig;
  messages: LlmIR[];
  abortSignal: AbortSignal;
  transport: Transport;
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
    transport,
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
