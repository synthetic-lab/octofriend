import { registry } from "antipattern";
import type { Transport } from "./transport.ts";
import {
  generateCompactionCheckpointContent,
  type CompactionError,
} from "./compilers/autocompact.ts";
import type { AutofixJsonFn, Compiler, CompilerIR } from "./compilers/compiler-interface.ts";
import type {
  Agent,
  Checkpoint,
  CompactionErrorIR,
  InterruptedByUserIR,
  ModelErrorIR,
} from "./llm-ir.ts";
import { userInterruptReason } from "./compilers/ir-prompts.ts";
import { err, ok, type Result } from "./result.ts";
import { combineSignals } from "./signals.ts";

export type AutocompactionStream = {
  type: "autocompaction-stream";
  buffer: { reasoning?: string; content?: string };
  delta: { type: "reasoning" | "content"; value: string };
};

export type TrajectoryCompactionEvents = {
  startCompaction: null;
  compactionProgress: AutocompactionStream;
};

export type TrajectoryCompactionIR =
  | Checkpoint
  | CompactionErrorIR
  | InterruptedByUserIR
  | ModelErrorIR;

export type TrajectoryCompactionParams<A extends Agent<any, any, any, any>, Model> = {
  model: Model;
  messages: Array<CompilerIR<A>>;
  runCompiler: Compiler<Model>;
  transport: Transport;
  abortSignal: AbortSignal;
  quitSignal: AbortSignal;
  autofixJson?: AutofixJsonFn;
  handler?: Partial<{
    [K in keyof TrajectoryCompactionEvents]: (
      event: TrajectoryCompactionEvents[K],
    ) => void | Promise<void>;
  }>;
};

// Exactly one summary attempt. The caller owns scheduling, retries and persistence;
// progress is ephemeral, and no checkpoint or failure IR is published in flight.
export const trajectoryCompaction = registry({ run: runTrajectoryCompaction });

async function runTrajectoryCompaction<A extends Agent<any, any, any, any>, Model>(
  params: TrajectoryCompactionParams<A, Model>,
): Promise<Result<TrajectoryCompactionIR, "quit">> {
  if (params.quitSignal.aborted) return err("quit");
  try {
    const ir = await compactionAttempt({
      ...params,
      abortSignal: combineSignals([params.abortSignal, params.quitSignal]),
    });
    if (params.quitSignal.aborted) return err("quit");
    return ok(ir);
  } catch (error) {
    if (params.quitSignal.aborted) return err("quit");
    throw error;
  }
}

async function compactionAttempt<A extends Agent<any, any, any, any>, Model>({
  model,
  messages,
  runCompiler,
  transport,
  abortSignal,
  autofixJson,
  handler,
}: TrajectoryCompactionParams<A, Model>): Promise<TrajectoryCompactionIR> {
  const interrupted: InterruptedByUserIR = {
    role: "interrupted-by-user",
    reason: userInterruptReason(),
  };
  if (abortSignal.aborted) return interrupted;
  await handler?.startCompaction?.(null);
  if (abortSignal.aborted) return interrupted;

  const buffer: AutocompactionStream["buffer"] = {};
  const result = await generateCompactionCheckpointContent<A>({
    messages,
    run: compactionMessages => {
      return runCompiler<A, undefined>({
        model,
        irs: compactionMessages,
        abortSignal,
        transport,
        autofixJson,
        onTokens: async (tokens, type) => {
          if (abortSignal.aborted) return;
          buffer[type] = (buffer[type] ?? "") + tokens;
          await handler?.compactionProgress?.({
            type: "autocompaction-stream",
            buffer,
            delta: { value: tokens, type },
          });
        },
      });
    },
  });

  // Persist the interruption, not a partial summary or cancellation-induced error.
  if (abortSignal.aborted) return interrupted;
  if (!result.success) return compactionErrorIR(result.error);
  return { role: "checkpoint", content: result.data };
}

function compactionErrorIR(error: CompactionError): CompactionErrorIR | ModelErrorIR {
  // Compiler errors use `type`, while persisted IR uses `role`. Copy only the IR
  // fields, rather than returning the error or persisting its headers/transport metadata.
  switch (error.type) {
    case "auth-error":
      return { role: "auth-error", authError: error.authError };
    case "payment-error":
    case "rate-limit-error":
      return { role: error.type, requestError: error.requestError };
    case "compaction-error":
    case "request-error":
    case "stream-error":
      return { role: "compaction-error", requestError: error.requestError, curl: error.curl };
  }
}
