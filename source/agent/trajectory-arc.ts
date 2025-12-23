import { LlmIR, OutputIR, CompactionCheckpoint, ToolCallRequest } from "../ir/llm-ir.ts";
import { toLlmIR, outputToHistory } from "../ir/convert-history-ir.ts";
import { HistoryItem } from "../history.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "../compilers/run.ts";
import { generateCompactionSummary, shouldAutoCompactHistory } from "../compilers/autocompact.ts";
import { AsyncGeneratorQueue } from "../generator-queue.ts";

type AllTokenTypes = "reasoning"
                   | "content"
                   | "tool"
                   ;

type AssistantBuffer<AllowedType extends string> = {
  [K in AllowedType]?: string;
};

type IRType = {
  type: "llm-ir",
  ir: OutputIR | CompactionCheckpoint,
};

type StateChange =
  { type: "compacting", content: string }
  | { type: "autofixing-json" }
  ;

// TODO: compaction actually shouldn't allow for tools, so run() should be modified to not send tool
// types if no tools are given
type AutocompactionStream = {
  type: "autocompaction-buffer", buffer: AssistantBuffer<AllTokenTypes>
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
};

export type AgentOutput =
  IRType
  | { type: "state-change", change: StateChange }
  | { type: "assistant-chunk-buffer", buffer: AssistantBuffer<AllTokenTypes> }
  | AutocompactionStream
  | Finish
  ;

/*
 * Given some LLM IR, it runs the next arc of the trajectory until:
 *
 * 1. The agent needs a user response, or
 * 2. The agent needs to call a tool, or
 * 3. The abort signal is fired.
 */
export async function* trajectoryArc({ history, config, transport, modelOverride, abortSignal }: {
  history: HistoryItem[],
  config: Config,
  transport: Transport,
  modelOverride: string | null,
  abortSignal: AbortSignal,
}): AsyncGenerator<AgentOutput, Finish> {
  if (abortSignal.aborted) {
    return {
      type: "finish",
      reason: { type: "abort" },
    };
  }

  const messages = toLlmIR(history);

  for await(const item of maybeAutocompact({
    messages, config, transport, abortSignal, modelOverride,
  })) {
    yield item;
    if(item.type === "llm-ir") messages.push(item.ir);
  }

  if (abortSignal.aborted) {
    return {
      type: "finish",
      reason: { type: "abort" },
    };
  }

  const tokensGenerator = new AsyncGeneratorQueue<AgentOutput>();
  let buffer: AssistantBuffer<AllTokenTypes> = {};
  const resultPromise = tokensGenerator.wrapPromise(run({
    config, modelOverride, transport, messages,
    onTokens: (tokens, type) => {
      if(!buffer[type]) buffer[type] = "";
      buffer[type] += tokens;
      tokensGenerator.push({
        type: "assistant-chunk-buffer",
        buffer,
      });
    },
    onAutofixJson: () => {
      tokensGenerator.push({
        type: "state-change",
        change: { type: "autofixing-json" },
      });
    },
    abortSignal,
  }));
  yield* tokensGenerator.items();

  if(abortSignal.aborted) {
    return {
      type: "finish",
      reason: { type: "abort" },
    };
  }

  const result = await resultPromise;
  if(!result.success) {
    if(abortSignal.aborted) {
      return {
        type: "finish",
        reason: { type: "abort" },
      };
    }
    throw new RequestError(result.requestError, result.curl);
  }

  const irs: OutputIR[] = [];
  for(const item of result.output) {
    irs.push(item);
    yield { type: "llm-ir", ir: item };
  }
  if(irs.length === 0) {
    throw new RequestError("No response from backend", result.curl);
  }
  let lastIr = irs[irs.length - 1];

  // Retry malformed tool calls
  if(lastIr.role === "tool-malformed") {
    for await(const yielded of trajectoryArc({
      config, modelOverride, transport, abortSignal,
      history: history.concat(outputToHistory(irs)),
    })) {
      if(yielded.type === "finish") return yielded;
      yield yielded;
    }
    throw new RequestError("Internal loop never yielded a finish", result.curl);
  }

  const { toolCall } = lastIr;
  if(toolCall) {
    return {
      type: "finish",
      reason: {
        type: "request-tool",
        toolCall,
      },
    };
  }

  return {
    type: "finish",
    reason: {
      type: "needs-response",
    },
  };
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
}): AsyncGenerator<AutocompactionStream | IRType> {
  if (!shouldAutoCompactHistory(messages, config, modelOverride, config.autoCompact)) return;

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
        type: "autocompaction-buffer",
        buffer,
      });
    },
    () => {},
    abortSignal
  ));

  yield* checkpointChunks.items();
  const checkpointSummary = await checkpointPromise;

  if(abortSignal.aborted) return;

  if(checkpointSummary) {
    yield {
      type: "llm-ir",
      ir: {
        role: "compaction-checkpoint",
        summary: checkpointSummary,
      },
    };
  }
}

export class RequestError extends Error {
  constructor(message: string, public curl: string | null) {
    super(message);
    this.name = this.constructor.name;
  }
}
