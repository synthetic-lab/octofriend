import fs from "fs/promises";
import { LlmIR, TrajectoryOutputIR, CompactionCheckpoint, ToolCallRequest } from "../ir/llm-ir.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "../compilers/run.ts";
import { generateCompactionSummary, shouldAutoCompactHistory } from "../compilers/autocompact.ts";
import { validateTool, ToolError } from "../tools/index.ts";
import { autofixEdit } from "../compilers/autofix.ts";

type AllTokenTypes = "reasoning"
                   | "content"
                   | "tool"
                   ;

type AssistantBuffer<AllowedType extends string> = {
  [K in AllowedType]?: string;
};
type AssistantDelta<AllowedType extends string> = {
  value: string,
  type: AllowedType,
};

type CompactionType = {
  checkpoint: CompactionCheckpoint,
};

// TODO: compaction actually shouldn't allow for tools, so run() should be modified to not send tool
// types if no tools are given
type AutocompactionStream = {
  type: "autocompaction-stream",
  buffer: AssistantBuffer<AllTokenTypes>,
  delta: AssistantDelta<AllTokenTypes>,
};

export type StateEvents = {
  startResponse: null,
  responseProgress: {
    buffer: AssistantBuffer<AllTokenTypes>,
    delta: AssistantDelta<AllTokenTypes>,
  },
  startCompaction: null,
  compactionProgress: AutocompactionStream,
  compactionParsed: CompactionType,
  autofixingJson: null,
  autofixingDiff: null,
  retryTool: {
    irs: TrajectoryOutputIR[],
  },
};

export type AnyState = keyof StateEvents;

type Finish = {
  type: "finish",
  irs: TrajectoryOutputIR[],
  reason: {
    type: "abort",
  } | {
    type: "needs-response",
  } | {
    type: "request-tool",
    toolCall: ToolCallRequest,
  } | {
    type: "request-error",
    requestError: string,
    curl: string,
  },
};

/*
 * Given some LLM IR, it runs the next arc of the trajectory until one of the finish reasons defined
 * above is hit.
 */
export async function trajectoryArc({
  messages, config, transport, modelOverride, abortSignal, handler
}: {
  messages: LlmIR[],
  config: Config,
  transport: Transport,
  modelOverride: string | null,
  abortSignal: AbortSignal,
  handler: {
    [K in AnyState]: (state: StateEvents[K]) => void
  }
}): Promise<Finish> {
  if (abortSignal.aborted) return abort([]);

  const messagesCopy = [ ...messages ];

  const parsedCompaction = await maybeAutocompact({
    messages: messagesCopy, config, transport, abortSignal, modelOverride,
    handler: {
      startCompaction: () => handler.startCompaction(null),
      compactionProgress: (stream) => handler.compactionProgress(stream),
    },
  });

  if(parsedCompaction) handler.compactionParsed(parsedCompaction);
  if(abortSignal.aborted) return abort([]);

  handler.startResponse(null);

  let buffer: AssistantBuffer<AllTokenTypes> = {};
  const result = await run({
    config, modelOverride, transport, messages: messagesCopy,
    onTokens: (tokens, type) => {
      if(!buffer[type]) buffer[type] = "";
      buffer[type] += tokens;
      handler.responseProgress({
        buffer,
        delta: { type, value: tokens },
      });
    },
    onAutofixJson: () => {
      handler.autofixingJson(null);
    },
    abortSignal,
  });

  function maybeBufferedMessage(): TrajectoryOutputIR[] {
    if(buffer.content || buffer.reasoning || buffer.tool) {
      return [{
        role: "assistant",
        content: buffer.content || "",
        reasoningContent: buffer.reasoning,
        tokenUsage: 0,
        outputTokens: 0,
      }];
    }
    return [];
  }

  if(!result.success) {
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

  const irs = result.output;
  if(irs.length === 0) {
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

  let lastIr = irs[irs.length - 1];

  // Retry malformed tool calls
  if(lastIr.role === "tool-malformed") {
    handler.retryTool({ irs });
    return await trajectoryArc({
      config, modelOverride, transport, abortSignal,
      messages: messagesCopy.concat(irs),
      handler,
    });
  }

  const { toolCall } = lastIr;

  if(toolCall == null) {
    return {
      type: "finish",
      reason: {
        type: "needs-response",
      },
      irs,
    };
  }

  try {
    await validateTool(abortSignal, transport, toolCall.function, config);
    return {
      type: "finish",
      reason: {
        type: "request-tool",
        toolCall,
      },
      irs,
    };
  } catch(e) {
    if(!(e instanceof ToolError)) throw e;

    const fn = toolCall.function;
    if(fn.name === "edit") {
      handler.autofixingDiff(null);
      const path = fn.arguments.filePath;
      try {
        const file = await fs.readFile(path, "utf8");
        const fix = await autofixEdit(config, file, fn.arguments, abortSignal);

        // If we aborted the autofix, slice off the messed up tool call and replace it with a failed
        // tool call
        if(abortSignal.aborted) {
          return abort([
            ...irs.slice(0, -1),
            {
              role: "tool-error",
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.function.name,
              error: e.message,
            }
          ]);
        }

        if(fix) {
          // Validate that the edit applies before marking as fixed
          await validateTool(abortSignal, transport, {
            name: "edit",
            arguments: fix,
          }, config);
          // If we got this far, it's valid: update the state and return
          fn.arguments = {
            ...fn.arguments,
            ...fix,
          };
          return {
            type: "finish",
            reason: {
              type: "request-tool",
              toolCall,
            },
            irs,
          };
        }
      } catch {}
    }

    const retryIrs = [
      ...irs.slice(0, -1),
      {
        role: "tool-error" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.function.name,
        error: e.message,
      }
    ];
    handler.retryTool({ irs: retryIrs });
    return await trajectoryArc({
      config, modelOverride, transport, abortSignal,
      messages: messagesCopy.concat(retryIrs),
      handler,
    });
  }
}

async function maybeAutocompact({
  messages,
  config,
  modelOverride,
  transport,
  abortSignal,
  handler,
}: {
  messages: LlmIR[];
  config: Config;
  modelOverride: string | null,
  transport: Transport;
  abortSignal: AbortSignal;
  handler: {
    startCompaction: () => void,
    compactionProgress: (stream: AutocompactionStream) => void,
  },
}): Promise<CompactionType | null> {
  if(!shouldAutoCompactHistory(messages, config, modelOverride, config.autoCompact)) return null;

  handler.startCompaction();

  const buffer: AssistantBuffer<AllTokenTypes> = {};
  const checkpointSummary = await generateCompactionSummary(
    messages,
    config,
    transport,
    modelOverride,
    (tokens, type) => {
      if(!buffer[type]) buffer[type] = "";
      buffer[type] += tokens;
      handler.compactionProgress({
        type: "autocompaction-stream",
        buffer,
        delta: { value: tokens, type, },
      });
    },
    () => {},
    abortSignal
  );

  if(checkpointSummary == null) return null;

  return {
    checkpoint: {
      role: "compaction-checkpoint",
      summary: checkpointSummary,
    },
  };
}

export class RequestError extends Error {
  constructor(message: string, public curl: string | null) {
    super(message);
    this.name = this.constructor.name;
  }
}

function abort(irs: TrajectoryOutputIR[]): Finish {
  return {
    type: "finish",
    reason: { type: "abort" },
    irs,
  };
}
