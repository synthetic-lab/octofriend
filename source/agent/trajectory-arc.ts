import fs from "fs/promises";
import { LlmIR, TrajectoryOutputIR, CompactionCheckpoint, ToolCallRequest } from "../ir/llm-ir.ts";
import { Config, ModelConfig } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "../compilers/run.ts";
import {
  generateCompactionSummary,
  shouldAutoCompactHistory,
} from "../compilers/autocompact.ts";
import { validateTool, ToolError } from "../tools/index.ts";
import { autofixEdit } from "../compilers/autofix.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";
import { autofixJson as originalAutofixJson } from "../compilers/autofix.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import * as toolMap from "../tools/index.ts";

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
  apiKey, model, messages, config, transport, abortSignal, handler
}: {
  apiKey: string,
  model: ModelConfig,
  messages: LlmIR[],
  config: Config,
  transport: Transport,
  abortSignal: AbortSignal,
  handler: {
    [K in AnyState]: (state: StateEvents[K]) => void
  }
}): Promise<Finish> {
  if (abortSignal.aborted) return abort([]);

  const messagesCopy = [ ...messages ];
  const autofixJson = async (badJson: string, signal: AbortSignal) => {
    return originalAutofixJson(config, badJson, signal);
  };
  const hasMcp = config.mcpServers != null && Object.keys(config.mcpServers).length > 0;
  const tools = hasMcp ? { ...toolMap } : (() => {
    const toolsCopy: Partial<typeof toolMap> = { ...toolMap };
    delete toolsCopy.mcp;
    return toolsCopy;
  })();

  const parsedCompaction = await maybeAutocompact({
    apiKey, model, config, transport, abortSignal, autofixJson,
    messages: messagesCopy,
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
    apiKey, model, transport, autofixJson, abortSignal, tools,
    messages: messagesCopy,
    handlers: {
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
    },
    systemPrompt: async (appliedWindow) => {
      return systemPrompt({
        config, transport, appliedWindow,
        signal: abortSignal,
      });
    },
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

  if(abortSignal.aborted) return abort(maybeBufferedMessage());

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
      apiKey, model, config, transport, abortSignal,
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
      apiKey, model, config, transport, abortSignal,
      messages: messagesCopy.concat(retryIrs),
      handler,
    });
  }
}

async function maybeAutocompact({
  apiKey,
  model,
  messages,
  config,
  transport,
  abortSignal,
  handler,
  autofixJson,
}: {
  apiKey: string,
  model: ModelConfig,
  messages: LlmIR[];
  config: Config;
  transport: Transport;
  abortSignal: AbortSignal;
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>,
  handler: {
    startCompaction: () => void,
    compactionProgress: (stream: AutocompactionStream) => void,
  },
}): Promise<CompactionType | null> {
  if(!shouldAutoCompactHistory(model, messages, config.autoCompact)) return null;

  handler.startCompaction();

  const buffer: AssistantBuffer<AllTokenTypes> = {};
  const checkpointSummary = await generateCompactionSummary({
    apiKey, model, messages, transport, abortSignal, autofixJson,
    handlers: {
     onTokens: (tokens, type) => {
        if(!buffer[type]) buffer[type] = "";
        buffer[type] += tokens;
        handler.compactionProgress({
          type: "autocompaction-stream",
          buffer,
          delta: { value: tokens, type, },
        });
      },
      onAutofixJson: () => {},
    },
  });

  if(checkpointSummary == null) return null;

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
