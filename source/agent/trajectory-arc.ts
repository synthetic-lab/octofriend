import fs from "fs/promises";
import { LlmIR, TrajectoryOutputIR, CompactionCheckpoint, ToolCallRequest } from "../ir/llm-ir.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "../compilers/run.ts";
import { generateCompactionSummary, shouldAutoCompactHistory } from "../compilers/autocompact.ts";
import { AsyncGeneratorQueue } from "../generator-queue.ts";
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

type Finish = {
  type: "finish",
  reason: {
    type: "abort",
  } | {
    type: "needs-response",
  } | {
    type: "request-tool",
    toolCall: ToolCallRequest,
  },
  irs: TrajectoryOutputIR[],
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

export type StateMachineEvent<S extends AnyState, E extends StateEvents[S]> = {
  state: S,
  event: E,
};

function createEvent<S extends AnyState, E extends StateEvents[S]>(
  state: S,
  event: E
): StateMachineEvent<S, E> {
  return {
    state, event,
  };
}

export type AgentOutput = {
  [S in AnyState]: StateMachineEvent<S, StateEvents[S]>
}[AnyState];

export function trajectoryEventHandler(handler: {
  [K in AnyState]: (state: StateEvents[K]) => void
}) {
  return (e: StateMachineEvent<any, any>) => {
    // @ts-ignore
    handler[e.state](e.event);
  };
}

/*
 * Given some LLM IR, it runs the next arc of the trajectory until:
 *
 * 1. The agent needs a user response, or
 * 2. The agent needs to call a tool, or
 * 3. The abort signal is fired.
 */
export async function* trajectoryArc({ messages, config, transport, modelOverride, abortSignal }: {
  messages: LlmIR[],
  config: Config,
  transport: Transport,
  modelOverride: string | null,
  abortSignal: AbortSignal,
}): AsyncGenerator<AgentOutput, Finish> {
  if (abortSignal.aborted) return abort([]);

  const messagesCopy = [ ...messages ];

  const compactionGenerator = maybeAutocompact({
    messages: messagesCopy, config, transport, abortSignal, modelOverride,
  });
  let compactionResult = await compactionGenerator.next();
  while(!compactionResult.done) {
    if(compactionResult.value.type === "start-compaction") {
      yield createEvent("startCompaction", null);
    }
    else {
      yield createEvent("compactionProgress", compactionResult.value);
    }

    compactionResult = await compactionGenerator.next();
  }
  const parsedCompaction = compactionResult.value;
  if(parsedCompaction) {
    yield createEvent("compactionParsed", parsedCompaction);
  }

  if (abortSignal.aborted) return abort([]);

  yield createEvent("startResponse", null);

  const tokensGenerator = new AsyncGeneratorQueue<AgentOutput>();
  let buffer: AssistantBuffer<AllTokenTypes> = {};
  const resultPromise = tokensGenerator.wrapPromise(run({
    config, modelOverride, transport, messages: messagesCopy,
    onTokens: (tokens, type) => {
      if(!buffer[type]) buffer[type] = "";
      buffer[type] += tokens;
      tokensGenerator.push(createEvent("responseProgress", {
        buffer,
        delta: { type, value: tokens },
      }));
    },
    onAutofixJson: () => {
      tokensGenerator.push(createEvent("autofixingJson", null));
    },
    abortSignal,
  }));
  yield* tokensGenerator.items();

  function bufferToIR(): TrajectoryOutputIR[] {
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
  if(abortSignal.aborted) return abort(bufferToIR());

  const result = await resultPromise;
  if(!result.success) {
    if(abortSignal.aborted) return abort(bufferToIR());
    throw new RequestError(result.requestError, result.curl);
  }

  const irs = result.output;
  if(irs.length === 0) {
    throw new RequestError("No response from backend", result.curl);
  }

  let lastIr = irs[irs.length - 1];

  // Retry malformed tool calls
  if(lastIr.role === "tool-malformed") {
    yield createEvent("retryTool", { irs });
    const generator = trajectoryArc({
      config, modelOverride, transport, abortSignal,
      messages: messagesCopy.concat(irs),
    });
    let result = await generator.next();
    while(!result.done) {
      yield result.value;
      result = await generator.next();
    }
    return result.value;
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
      yield createEvent("autofixingDiff", null);
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

    yield createEvent("retryTool", {
      irs: [
        ...irs.slice(0, -1),
        {
          role: "tool-error",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.function.name,
          error: e.message,
        }
      ],
    });
    const generator = trajectoryArc({
      config, modelOverride, transport, abortSignal,
      messages: messagesCopy.concat([
        ...irs.slice(0, -1),
        {
          role: "tool-error",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.function.name,
          error: e.message,
        },
      ]),
    });
    let result = await generator.next();
    while(!result.done) {
      yield result.value;
      result = await generator.next();
    }
    return result.value;
  }
}

async function* maybeAutocompact({
  messages,
  config,
  modelOverride,
  transport,
  abortSignal,
}: {
  messages: LlmIR[];
  config: Config;
  modelOverride: string | null,
  transport: Transport;
  abortSignal: AbortSignal;
}): AsyncGenerator<AutocompactionStream | { type: "start-compaction" }, CompactionType | null> {
  if (!shouldAutoCompactHistory(messages, config, modelOverride, config.autoCompact)) {
    return null;
  }

  yield { type: "start-compaction" };

  const checkpointChunks = new AsyncGeneratorQueue<AutocompactionStream>();

  const buffer: AssistantBuffer<AllTokenTypes> = {};
  const checkpointPromise = checkpointChunks.wrapPromise(generateCompactionSummary(
    messages,
    config,
    transport,
    modelOverride,
    (tokens, type) => {
      if(!buffer[type]) buffer[type] = "";
      buffer[type] += tokens;
      checkpointChunks.push({
        type: "autocompaction-stream",
        buffer,
        delta: { value: tokens, type, },
      });
    },
    () => {},
    abortSignal
  ));

  yield* checkpointChunks.items();
  const checkpointSummary = await checkpointPromise;
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
