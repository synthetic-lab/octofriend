import { describe, expect, it } from "bun:test";
import { LocalTransport } from "../transports/local.ts";
import { compilerUsage, defineCompiler } from "./compilers/compiler-interface.ts";
import { userInterruptReason } from "./compilers/ir-prompts.ts";
import { err } from "./result.ts";
import { trajectoryCompaction } from "./trajectory-compaction.ts";

const transport = new LocalTransport();
const interrupted = { role: "interrupted-by-user", reason: userInterruptReason() };
const summaryCompiler = defineCompiler<null>(async ({ finish }) => {
  const output = {
    role: "assistant" as const,
    content: "completed summary",
    usage: compilerUsage(1, 1),
  };
  return finish({
    curl: "curl",
    headers: new Headers(),
    usage: output.usage,
    abortedOutput: output,
    parsedOutput: () => output,
  });
});

describe("trajectoryCompaction", () => {
  it.each(["before-start", "during-start"] as const)(
    "returns interruption IR when cancelled %s without calling the compiler",
    async when => {
      const interrupt = new AbortController();
      let calls = 0;
      let starts = 0;
      if (when === "before-start") interrupt.abort();
      const outcome = await trajectoryCompaction.run({
        model: null,
        messages: [],
        transport,
        abortSignal: interrupt.signal,
        runCompiler: async params => {
          calls++;
          return summaryCompiler(params);
        },
        handler: {
          startCompaction: () => {
            starts++;
            interrupt.abort();
          },
        },
      });
      expect(outcome).toMatchObject(interrupted);
      expect(calls).toBe(0);
      expect(starts).toBe(when === "before-start" ? 0 : 1);
    },
  );

  it.each(["success", "error"] as const)(
    "returns interruption IR instead of the cancelled compiler's %s outcome",
    async finish => {
      const interrupt = new AbortController();
      const progress: string[] = [];
      const outcome = await trajectoryCompaction.run({
        model: null,
        messages: [],
        transport,
        abortSignal: interrupt.signal,
        runCompiler: async params => {
          await params.onTokens("partial summary", "content");
          interrupt.abort();
          await params.onTokens("late summary", "content");
          if (finish === "error") {
            return err({ type: "request-error", requestError: "cancelled", curl: "curl" });
          }
          return summaryCompiler(params);
        },
        handler: {
          compactionProgress: event => {
            progress.push(event.delta.value);
          },
        },
      });
      expect(outcome).toMatchObject(interrupted);
      expect(progress).toEqual(["partial summary"]);
    },
  );

  it("returns a completed checkpoint as IR", async () => {
    const outcome = await trajectoryCompaction.run({
      model: null,
      messages: [],
      transport,
      abortSignal: new AbortController().signal,
      runCompiler: summaryCompiler,
    });
    expect(outcome).toMatchObject({
      role: "checkpoint",
      content: expect.arrayContaining([{ type: "text", content: "completed summary" }]),
    });
  });

  it("returns a request failure as compaction IR", async () => {
    const outcome = await trajectoryCompaction.run({
      model: null,
      messages: [],
      transport,
      abortSignal: new AbortController().signal,
      runCompiler: async () => err({ type: "request-error", requestError: "failed", curl: "curl" }),
    });
    expect(outcome).toMatchObject({
      role: "compaction-error",
      requestError: "failed",
      curl: "curl",
    });
  });

  it("propagates exceptions when the signal is not aborted", async () => {
    await expect(
      trajectoryCompaction.run({
        model: null,
        messages: [],
        transport,
        abortSignal: new AbortController().signal,
        runCompiler: async () => {
          throw new Error("compiler failed");
        },
      }),
    ).rejects.toThrow("compiler failed");
  });
});
