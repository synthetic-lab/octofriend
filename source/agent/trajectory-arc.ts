import fs from "fs/promises";
import type { OctoIR } from "../ir/octo-ir.ts";
import type {
  Content,
  MalformedToolRequest,
  AssistantMessage,
  ToolValidationErrorMessage,
} from "../libocto/llm-ir.ts";
import type { ToolCall } from "../libocto/tool-def.ts";
import type toolMap from "../tools/tool-defs/index.ts";
import { QuotaData } from "../utils/quota.ts";
import { parseQuotaJson } from "../utils/quota.ts";
import { Config } from "../config.ts";
import type { ModelData } from "../compilers/run.ts";
import { Transport } from "../transports/transport-common.ts";
import { run } from "../compilers/run.ts";
import type { CompilerError } from "../libocto/compilers/compiler-interface.ts";
import { compilerUsage } from "../libocto/compilers/compiler-interface.ts";
import {
  CompactionError,
  generateCompactionCheckpointContent,
  shouldAutoCompactHistory,
} from "../libocto/compilers/autocompact.ts";
import { validateTool } from "../tools/index.ts";
import { autofixEdit } from "../compilers/autofix.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";
import { makeAutofixJson } from "../compilers/autofix.ts";
import { JsonFixResponse } from "../prompts/autofix-prompts.ts";
import { loadTools } from "../tools/index.ts";
import { Result, ok } from "../libocto/result.ts";
import { lowerOcto } from "../compilers/lower-octo.ts";

const SKIP_INVALID_REASON = "One of your other tool calls was invalid, so no tool calls were run";

type ToolCallRequest = ToolCall<typeof toolMap>;

export type RetryCountdown = {
  attempt: number;
  secondsLeft: number;
};

export const RETRY_INTERVAL_MS = 5000;
export const MAX_RETRY_INTERVAL_MS = 10 * 60 * 1000;
export const RETRIES_BEFORE_BACKOFF = 2;

/*
 * The first couple of retries use a fixed short interval; after that the interval doubles each
 * attempt, capped at MAX_RETRY_INTERVAL_MS. Retries continue until the request succeeds or the
 * user stops them.
 */
export function retryIntervalForAttempt(attempt: number): number {
  if (attempt <= RETRIES_BEFORE_BACKOFF) return RETRY_INTERVAL_MS;
  const backoff = RETRY_INTERVAL_MS * 2 ** (attempt - RETRIES_BEFORE_BACKOFF);
  return Math.min(backoff, MAX_RETRY_INTERVAL_MS);
}

/*
 * Abort reason for the retryCountdown abortController that skips the rest of the countdown and
 * retries immediately. Aborting with any other reason (or none) stops retrying entirely.
 */
export const RETRY_NOW = "octo-retry-now";

export type TrajectoryOutputIR =
  | AssistantMessage<typeof toolMap>
  | {
      role: "tool-parse-error";
      malformedRequest: MalformedToolRequest;
    }
  | ToolValidationErrorMessage<typeof toolMap>
  | {
      role: "tool-skip-output";
      toolCall: ToolCallRequest;
      reason: string;
    }
  | Extract<OctoIR, { role: "file-read" | "file-mutate" }>
  | {
      role: "checkpoint";
      content: Content["content"];
    };

type ResponseTokenTypes = "reasoning" | "content" | "tool";
type CompactionTokenTypes = Exclude<ResponseTokenTypes, "tool">;

type AssistantBuffer<AllowedType extends string> = {
  [K in AllowedType]?: string;
};
type AssistantDelta<AllowedType extends string> = {
  value: string;
  type: AllowedType;
};

type CompactionType = {
  checkpoint: TrajectoryOutputIR & { role: "checkpoint" };
};

type RecoverableRequestError = Extract<
  CompilerError,
  { type: "payment-error" | "rate-limit-error" }
>;

type AutocompactionStream = {
  type: "autocompaction-stream";
  buffer: AssistantBuffer<CompactionTokenTypes>;
  delta: AssistantDelta<CompactionTokenTypes>;
};

export type StateEvents = {
  startResponse: null;
  responseProgress: {
    buffer: AssistantBuffer<ResponseTokenTypes>;
    delta: AssistantDelta<ResponseTokenTypes>;
  };
  startCompaction: null;
  compactionProgress: AutocompactionStream;
  compactionParsed: CompactionType;
  autofixingJson: null;
  autofixingDiff: null;
  retryTool: {
    irs: TrajectoryOutputIR[];
  };
  retryCountdown: {
    failure: "request-error" | "compaction-error";
    countdown: RetryCountdown;
    abortController: AbortController;
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
      }
    | {
        type: "auth-error";
        authError: string;
      }
    | RecoverableRequestError
    | {
        type: "compaction-error";
        requestError: string;
        curl: string | null;
      };
};

type TrajectoryArcArgs = {
  modelData: ModelData;
  messages: OctoIR[];
  config: Config;
  transport: Transport;
  abortSignal: AbortSignal;
  handler: {
    [K in AnyState]: (state: StateEvents[K]) => void;
  };
};

/*
 * Given some LLM IR, it runs the next arc of the trajectory until one of the finish reasons defined
 * above is hit.
 *
 * Request and compaction errors don't require the harness to take action, so they're retried here
 * with backoff rather than surfaced immediately: each countdown tick fires the retryCountdown
 * handler with an abortController — aborting it with RETRY_NOW skips the rest of the countdown,
 * and aborting with any other reason stops retrying and finishes with the error.
 */
export async function trajectoryArc(args: TrajectoryArcArgs): Promise<Finish> {
  let messages = args.messages;
  let irs: TrajectoryOutputIR[] = [];
  let attempt = 0;
  while (true) {
    const finish = await trajectoryArcAttempt({ ...args, messages });
    irs = irs.concat(finish.irs);
    const { reason } = finish;
    if (reason.type !== "request-error" && reason.type !== "compaction-error") {
      return { type: "finish", irs, reason };
    }

    attempt++;
    const outcome = await retryCountdown({
      attempt,
      failure: reason.type,
      abortSignal: args.abortSignal,
      handler: args.handler,
    });
    if (outcome === "aborted") return { type: "finish", irs, reason: { type: "abort" } };
    if (outcome === "stopped") return { type: "finish", irs, reason };
    // Failed attempts still happened: the model may have streamed partial content before the
    // request died, so subsequent attempts need the failed attempt's IRs in context.
    messages = messages.concat(finish.irs);
  }
}

async function retryCountdown({
  attempt,
  failure,
  abortSignal,
  handler,
}: {
  attempt: number;
  failure: "request-error" | "compaction-error";
  abortSignal: AbortSignal;
  handler: TrajectoryArcArgs["handler"];
}): Promise<"retry" | "stopped" | "aborted"> {
  const abortController = new AbortController();
  const deadline = Date.now() + retryIntervalForAttempt(attempt);
  while (true) {
    if (abortSignal.aborted) return "aborted";
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return "retry";
    handler.retryCountdown({
      failure,
      countdown: {
        attempt,
        secondsLeft: Math.ceil(remainingMs / 1000),
      },
      abortController,
    });
    await sleepUnlessAborted(Math.min(1000, remainingMs), [abortController.signal, abortSignal]);
    if (abortController.signal.aborted) {
      return abortController.signal.reason === RETRY_NOW ? "retry" : "stopped";
    }
  }
}

function sleepUnlessAborted(ms: number, signals: AbortSignal[]): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", finish);
      resolve();
    }
    for (const signal of signals) {
      if (signal.aborted) return finish();
      signal.addEventListener("abort", finish);
    }
  });
}

async function trajectoryArcAttempt({
  modelData,
  messages,
  config,
  transport,
  abortSignal,
  handler,
}: TrajectoryArcArgs): Promise<Finish> {
  if (abortSignal.aborted) return abort([]);

  const messagesCopy = [...messages];
  const autofixJson = makeAutofixJson(config);
  let irs: TrajectoryOutputIR[] = [];
  const tools = await loadTools(transport, abortSignal, config);
  const { model } = modelData;

  const parsedCompaction = await maybeAutocompact({
    modelData,
    abortSignal,
    transport,
    autofixJson,
    messages: messagesCopy,
    handler: {
      startCompaction: () => handler.startCompaction(null),
      compactionProgress: stream => handler.compactionProgress(stream),
    },
  });
  if (!parsedCompaction.success) {
    if (
      isRecoverableRequestError(parsedCompaction.error) ||
      parsedCompaction.error.type === "auth-error"
    ) {
      return {
        type: "finish",
        irs,
        reason: parsedCompaction.error,
      };
    }

    return {
      type: "finish",
      irs,
      reason: {
        type: "compaction-error",
        requestError: parsedCompaction.error.requestError,
        curl: parsedCompaction.error.curl,
      },
    };
  }

  if (parsedCompaction.data) {
    handler.compactionParsed(parsedCompaction.data);
    messagesCopy.push(parsedCompaction.data.checkpoint);
    irs.push(parsedCompaction.data.checkpoint);
  }
  if (abortSignal.aborted) return abort([]);

  handler.startResponse(null);

  let buffer: AssistantBuffer<ResponseTokenTypes> = {};
  const loweredMessages = lowerOcto(messagesCopy, model.modalities);
  const result = await run({
    modelData,
    autofixJson,
    abortSignal,
    transport,
    tools,
    messages: loweredMessages,
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
    systemPrompt: async () => {
      return systemPrompt({
        config,
        transport,
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
          usage: compilerUsage(0, 0),
        },
      ];
    }
    return [];
  }

  const headers = result.success
    ? result.data.headers
    : "headers" in result.error
      ? result.error.headers
      : undefined;
  const quota = parseQuotaFromHeaders(headers);
  if (quota) handler.onQuotaUpdated(quota);

  if (abortSignal.aborted) return abort(maybeBufferedMessage());

  if (!result.success) {
    return {
      type: "finish",
      irs: maybeBufferedMessage(),
      reason: compilerErrorToFinishReason(result.error),
    };
  }

  let assistantMessage = result.data.output;
  irs = [...irs, assistantMessage];

  // Retry malformed tool calls
  let malformedRequests = false;
  for (const call of assistantMessage.toolCalls || []) {
    if (call.type === "malformed-tool-request") {
      malformedRequests = true;
      break;
    }
  }

  if (malformedRequests) {
    // Insert tool skips for all of the non-malformed tool call IRs, and ensure the original order
    // is kept in terms of input ordering vs output message ordering
    for (const call of assistantMessage.toolCalls || []) {
      if (call.type === "tool-call") {
        irs.push({
          role: "tool-skip-output",
          toolCall: call,
          reason: "Another tool call in this batch was malformed, so this tool call was skipped",
        });
      } else {
        const _: "malformed-tool-request" = call.type;
        irs.push({
          role: "tool-parse-error",
          malformedRequest: call,
        });
      }
    }

    handler.retryTool({ irs });
    const retried = await trajectoryArcAttempt({
      modelData,
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
    if (toolCall.type === "malformed-tool-request") {
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
    const validation = await validateTool(abortSignal, transport, tools, toolCall, config);

    if (validation.success) {
      // If we got this far, the tool validated successfully. Proactively push a tool-skip-output IR for
      // it, in case other tool calls fail to validate (since all tool calls will be skipped if any
      // are invalid).
      retryIrs.push({
        role: "tool-skip-output",
        toolCall: toolCall,
        reason: SKIP_INVALID_REASON,
      });
      continue;
    }

    const validationError = validation.error;
    const fn = toolCall;
    if (fn.name === "edit") {
      handler.autofixingDiff(null);
      const path = fn.parsed.filePath;
      const file = await fs.readFile(path, "utf8");
      const fix = await autofixEdit(config, file, fn.parsed, abortSignal);

      // If we aborted the autofix, slice off the messed up tool call and replace it with a failed
      // tool call
      if (abortSignal.aborted) {
        return abort([
          ...irs.slice(0, -1),
          {
            role: "tool-validation-error",
            toolCall: toolCall,
            error: validationError,
            aborted: true,
          },
        ]);
      }

      if (fix) {
        // Validate that the edit applies before marking as fixed
        const fixed = {
          ...fn.parsed,
          ...fix,
        } as const;

        const fixedValidation = await validateTool(
          abortSignal,
          transport,
          tools,
          { ...fn, parsed: fixed },
          config,
        );
        if (fixedValidation.success) {
          // If we got this far, it's valid: update the state and keep going
          fn.parsed = {
            ...fn.parsed,
            ...fix,
          };

          // Push a tool skip proactively
          retryIrs.push({
            role: "tool-skip-output",
            toolCall: toolCall,
            reason: SKIP_INVALID_REASON,
          });

          continue;
        }
      }
    }

    retryIrs = [
      ...retryIrs,
      {
        role: "tool-validation-error" as const,
        toolCall: toolCall,
        error: validationError,
        aborted: false,
      },
    ];
  }

  // If you have any IRs that need to be retried, retry them
  let needsRetry = false;
  for (const ir of retryIrs) {
    if (ir.role !== "tool-skip-output") {
      needsRetry = true;
      break;
    }
  }
  if (needsRetry) {
    const fullRetryTrajectory = [...irs, ...retryIrs];
    handler.retryTool({ irs: fullRetryTrajectory });
    const retried = await trajectoryArcAttempt({
      modelData,
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

function parseQuotaFromHeaders(headers: Headers | undefined): QuotaData | undefined {
  const raw = headers?.get("x-synthetic-quotas");
  if (!raw) return undefined;
  return parseQuotaJson(raw);
}

function compilerErrorToFinishReason(error: CompilerError): Finish["reason"] {
  if (error.type === "auth-error") return error;
  if (isRecoverableRequestError(error)) return error;
  return {
    type: "request-error",
    requestError: error.requestError,
    curl: error.curl,
  };
}

function isRecoverableRequestError(error: { type: string }): error is RecoverableRequestError {
  return error.type === "payment-error" || error.type === "rate-limit-error";
}

async function maybeAutocompact({
  modelData,
  messages,
  abortSignal,
  transport,
  handler,
  autofixJson,
}: {
  modelData: ModelData;
  messages: OctoIR[];
  abortSignal: AbortSignal;
  transport: Transport;
  autofixJson: (badJson: string, signal: AbortSignal) => Promise<JsonFixResponse>;
  handler: {
    startCompaction: () => void;
    compactionProgress: (stream: AutocompactionStream) => void;
  };
}): Promise<Result<CompactionType | null, CompactionError>> {
  const { model } = modelData;
  const loweredMessages = lowerOcto(messages, model.modalities);
  if (!shouldAutoCompactHistory(model.context, loweredMessages)) return ok(null);

  handler.startCompaction();

  const buffer: AssistantBuffer<CompactionTokenTypes> = {};
  const checkpointContent = await generateCompactionCheckpointContent({
    messages: loweredMessages,
    run: messages =>
      run({
        modelData,
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
      }),
  });

  if (!checkpointContent.success) return checkpointContent;
  if (checkpointContent.data == null) return ok(null);

  return ok({
    checkpoint: {
      role: "checkpoint",
      content: checkpointContent.data,
    },
  });
}

function abort(irs: TrajectoryOutputIR[]): Finish {
  return {
    type: "finish",
    reason: { type: "abort" },
    irs,
  };
}
