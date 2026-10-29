import { registry } from "antipattern";
import type { Transport } from "../transports/transport-common.ts";
import {
  generateCompactionCheckpointContent,
  type CompactionError,
} from "./compilers/autocompact.ts";
import type { AutofixJsonFn, Compiler, CompilerIR } from "./compilers/compiler-interface.ts";
import type { Agent, Checkpoint, CompactionErrorIR, ModelErrorIR } from "./llm-ir.ts";
import { err, ok, type Result } from "./result.ts";

export type AutocompactionStream = {
  type: "autocompaction-stream";
  buffer: { reasoning?: string; content?: string };
  delta: { type: "reasoning" | "content"; value: string };
};

export type TrajectoryCompactionEvents = {
  startCompaction: null;
  compactionProgress: AutocompactionStream;
};

export type TrajectoryCompactionIR = Checkpoint | CompactionErrorIR | ModelErrorIR;

export type TrajectoryCompactionParams<A extends Agent<any, any, any>, Model> = {
  model: Model;
  messages: Array<CompilerIR<A>>;
  runCompiler: Compiler<Model>;
  transport: Transport;
  abortSignal: AbortSignal;
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

async function runTrajectoryCompaction<A extends Agent<any, any, any>, Model>({
  model,
  messages,
  runCompiler,
  transport,
  abortSignal,
  autofixJson,
  handler,
}: TrajectoryCompactionParams<A, Model>): Promise<Result<TrajectoryCompactionIR, "aborted">> {
  if (abortSignal.aborted) return err("aborted");
  await handler?.startCompaction?.(null);
  if (abortSignal.aborted) return err("aborted");

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

  // A compiler may return partial content or a transport error after cancellation.
  // Neither is a completed compaction result that the supervisor should persist.
  if (abortSignal.aborted) return err("aborted");
  if (!result.success) return ok(compactionErrorIR(result.error));
  return ok({ role: "checkpoint", content: result.data });
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
