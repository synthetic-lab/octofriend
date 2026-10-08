import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  headlessRun,
  EXIT_OK,
  EXIT_STOPPED,
  EXIT_USAGE_ERROR,
  type HeadlessRunDeps,
  type HeadlessRunResult,
} from "./headless-run.ts";
import type { Config } from "../config.ts";
import type {
  Compiler,
  CompilerError,
  CompilerParams,
  CompilerResult,
  CompilerSuccessData,
  CompilerUsage,
} from "../libocto/compilers/compiler-interface.ts";
import { compilerUsage } from "../libocto/compilers/compiler-interface.ts";
import { err, ok, type Result } from "../libocto/result.ts";
import type { ModelData } from "../compilers/run.ts";
import type { Agent, AssistantMessage, LoweredIR } from "../libocto/llm-ir.ts";
import type { LoadedTools, ToolCall } from "../libocto/tool-def.ts";
import type { octoAgent } from "../ir/octo-ir.ts";
import type toolMap from "../tools/tool-defs/index.ts";
import { LocalTransport } from "../transports/local.ts";
import { loadSession } from "../session-history/index.ts";

/*
 * Tests for the headless driver (cli/headless-run.ts): turn completion, session persistence
 * and resume, the non-interactive permission policy, and --max-turns. Uses the same injected
 * mock-compiler seam as state.test.ts, so no provider traffic happens.
 */

type OctoAgent = typeof octoAgent;
type OctoAssistant = AssistantMessage<OctoAgent["tools"]>;
type ShellToolCall = Extract<ToolCall<typeof toolMap>, { name: "shell" }>;

const config: Config = {
  yourName: "Test",
  models: [
    {
      nickname: "test-model",
      model: "test-model",
      context: 128_000,
      baseUrl: "http://localhost",
      apiEnvVar: "OCTO_HEADLESS_TEST_API_KEY",
    },
  ],
};

const envBefore = process.env["OCTO_HEADLESS_TEST_API_KEY"];

beforeEach(() => {
  process.env["OCTO_HEADLESS_TEST_API_KEY"] = "test-key";
});

afterEach(() => {
  if (envBefore == null) delete process.env["OCTO_HEADLESS_TEST_API_KEY"];
  else process.env["OCTO_HEADLESS_TEST_API_KEY"] = envBefore;
});

function shellCall(id: string, cmd: string): ShellToolCall {
  return {
    type: "tool-call",
    name: "shell",
    toolCallId: id,
    original: { cmd, timeout: 60_000 },
    parsed: { cmd, timeout: 60_000 },
  };
}

type Emit = (tokens: string, type: "reasoning" | "content") => void;
type CompilerQueueItem = (
  onTokens: Emit,
  params: { abortSignal: AbortSignal },
) =>
  | Result<CompilerSuccessData<OctoAgent>, CompilerError>
  | Promise<Result<CompilerSuccessData<OctoAgent>, CompilerError>>;

function assistantMessage(opts: {
  content?: string;
  usage?: CompilerUsage;
  toolCalls?: OctoAssistant["toolCalls"];
}): OctoAssistant {
  return {
    role: "assistant",
    content: opts.content ?? "",
    usage: opts.usage ?? compilerUsage(1, 1),
    toolCalls: opts.toolCalls,
  };
}

function okResult(output: OctoAssistant): Result<CompilerSuccessData<OctoAgent>, CompilerError> {
  return ok({ output, curl: "curl", headers: new Headers(), usage: output.usage });
}

function plain(content: string): CompilerQueueItem {
  return () => okResult(assistantMessage({ content }));
}

const QUEUE_EXHAUSTED: CompilerQueueItem = () =>
  err({
    type: "payment-error",
    requestError: "mock compiler queue exhausted",
    curl: "curl",
    headers: new Headers(),
  });

function makeRunCompiler(queue: CompilerQueueItem[]) {
  const calls: Array<{ irs: Array<LoweredIR<any>> }> = [];
  const runCompiler: Compiler<ModelData> = async <
    A extends Agent<any, any, any>,
    Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
  >(
    params: CompilerParams<A, ModelData, Tools>,
  ): Promise<CompilerResult<A, Tools>> => {
    calls.push({ irs: [...params.irs] as Array<LoweredIR<any>> });
    const next = queue.shift() ?? QUEUE_EXHAUSTED;
    const result = await next(params.onTokens, params);
    return result as typeof result & CompilerResult<A, Tools>;
  };
  return { runCompiler, calls };
}

function makeDeps(runCompiler?: Compiler<ModelData>) {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const deps: HeadlessRunDeps = {
    config,
    transport: new LocalTransport(),
    runCompiler,
    stdout: chunk => {
      stdoutChunks.push(chunk);
    },
    stderr: chunk => {
      stderrChunks.push(chunk);
    },
  };
  return {
    deps,
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    stdoutJson: (): HeadlessRunResult => JSON.parse(stdoutChunks.join("")),
  };
}

function baseOptions(overrides: Partial<Parameters<typeof headlessRun>[1]>) {
  return {
    prompt: "do the thing",
    outputFormat: "json" as const,
    unchained: false,
    allowTools: [] as string[],
    ...overrides,
  };
}

function historyRoles(sessionId: string): string[] {
  const loaded = loadSession(sessionId);
  if (loaded == null) throw new Error(`expected session ${sessionId} to exist`);
  return loaded.history.map(node => (node.type === "llm-ir" ? node.ir.role : node.type));
}

describe("headlessRun", () => {
  it("completes one turn, prints the envelope, and persists the session", async () => {
    const { runCompiler } = makeRunCompiler([plain("all done")]);
    const { deps, stdoutJson } = makeDeps(runCompiler);

    const { exitCode, result } = await headlessRun(deps, baseOptions({}));

    expect(exitCode).toBe(EXIT_OK);
    expect(result.status).toBe("completed");
    expect(result.result).toBe("all done");
    expect(result.turns).toBe(1);
    expect(result.deniedTools).toEqual([]);
    expect(result.sessionId).not.toBeNull();
    expect(stdoutJson().version).toBe("octo-run/v1");
    expect(stdoutJson().sessionId).toBe(result.sessionId);
    expect(historyRoles(result.sessionId!)).toEqual(["user", "assistant"]);
  });

  it("resumes a session, hydrating the model with prior history", async () => {
    const first = makeRunCompiler([plain("first answer")]);
    const firstRun = await headlessRun(
      makeDeps(first.runCompiler).deps,
      baseOptions({ prompt: "first task" }),
    );
    expect(firstRun.exitCode).toBe(EXIT_OK);
    const sessionId = firstRun.result.sessionId!;

    const second = makeRunCompiler([plain("second answer")]);
    const secondDeps = makeDeps(second.runCompiler);
    const secondRun = await headlessRun(
      secondDeps.deps,
      baseOptions({ prompt: "second task", resume: sessionId }),
    );

    expect(secondRun.exitCode).toBe(EXIT_OK);
    expect(secondRun.result.sessionId).toBe(sessionId);
    expect(JSON.stringify(second.calls[0].irs)).toContain("first answer");
    expect(historyRoles(sessionId)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("fails with a usage error when resuming an unknown session", async () => {
    const { runCompiler } = makeRunCompiler([plain("never used")]);
    const { deps, stdoutJson } = makeDeps(runCompiler);

    const { exitCode, result } = await headlessRun(deps, baseOptions({ resume: "nope" }));

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(result.status).toBe("error");
    expect(result.error?.type).toBe("session-not-found");
    expect(stdoutJson().status).toBe("error");
  });

  it("rejects tools outside the headless permission policy and reports the denial", async () => {
    const { runCompiler } = makeRunCompiler([
      () => okResult(assistantMessage({ content: "", toolCalls: [shellCall("t1", "echo hi")] })),
      plain("could not run it"),
    ]);
    const { deps } = makeDeps(runCompiler);

    const { exitCode, result } = await headlessRun(deps, baseOptions({}));

    expect(exitCode).toBe(EXIT_OK);
    expect(result.status).toBe("completed");
    expect(result.deniedTools).toEqual(["shell"]);
    expect(result.result).toBe("could not run it");
    expect(historyRoles(result.sessionId!)).toEqual([
      "user",
      "assistant",
      "tool-reject",
      "user",
      "assistant",
    ]);
  });

  it("runs permitted tools when unchained", async () => {
    const { runCompiler } = makeRunCompiler([
      () =>
        okResult(
          assistantMessage({ content: "", toolCalls: [shellCall("t1", "echo hello-from-tool")] }),
        ),
      plain("tool ran"),
    ]);
    const { deps } = makeDeps(runCompiler);

    const { exitCode, result } = await headlessRun(deps, baseOptions({ unchained: true }));

    expect(exitCode).toBe(EXIT_OK);
    expect(result.deniedTools).toEqual([]);
    const roles = historyRoles(result.sessionId!);
    expect(roles).toEqual(["user", "assistant", "tool-output", "assistant"]);
    const loaded = loadSession(result.sessionId!)!;
    const toolOutput = loaded.history.find(
      node => node.type === "llm-ir" && node.ir.role === "tool-output",
    );
    expect(JSON.stringify(toolOutput)).toContain("hello-from-tool");
  });

  it("allows tools named with --allow-tool", async () => {
    const { runCompiler } = makeRunCompiler([
      () => okResult(assistantMessage({ content: "", toolCalls: [shellCall("t1", "echo hi")] })),
      plain("allowed"),
    ]);
    const { deps } = makeDeps(runCompiler);

    const { exitCode, result } = await headlessRun(deps, baseOptions({ allowTools: ["shell"] }));

    expect(exitCode).toBe(EXIT_OK);
    expect(result.deniedTools).toEqual([]);
    expect(historyRoles(result.sessionId!)).toEqual([
      "user",
      "assistant",
      "tool-output",
      "assistant",
    ]);
  });

  it("stops with max-turns when the model never stops calling tools", async () => {
    const repeatedCalls = Array.from({ length: 8 }, (_, index) => index).map(
      index => () =>
        okResult(
          assistantMessage({
            content: "",
            toolCalls: [shellCall(`call-${index}`, "echo hi")],
          }),
        ),
    );
    const { runCompiler } = makeRunCompiler(repeatedCalls);
    const { deps } = makeDeps(runCompiler);

    const { exitCode, result } = await headlessRun(
      deps,
      baseOptions({ unchained: true, maxTurns: 2 }),
    );

    expect(exitCode).toBe(EXIT_STOPPED);
    expect(result.status).toBe("max-turns");
    expect(result.turns).toBeGreaterThan(2);
  });
});
