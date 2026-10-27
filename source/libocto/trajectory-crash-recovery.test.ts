import { describe, expect, it } from "bun:test";
import { t } from "structural";
import { LocalTransport } from "../transports/local.ts";
import {
  compilerUsage,
  type Compiler,
  type CompilerError,
  type CompilerParams,
  type CompilerResult,
  type CompilerSuccessData,
} from "./compilers/compiler-interface.ts";
import { downconvert, inspectHistory } from "./ir-operations.ts";
import {
  definePermissionlessAgent,
  type Agent,
  type AgentIR,
  type AssistantMessage,
  type LowerInputIR,
  type LowerOutputIR,
  type LoweredIR,
  type MalformedToolRequest,
  type TreeIR,
} from "./llm-ir.ts";
import { err, ok, type Result } from "./result.ts";
import { ToolBuilder, type LoadedTools, type ToolCall } from "./tool-def.ts";
import { Trajectory } from "./trajectory.ts";

type ToolData = { executed: string[] };

// Deliberately do not repeat validation inside run: the runner must not execute a
// call that the arc has already rejected, even when its failure group was interrupted.
const searchTool = new ToolBuilder<ToolData>()
  .declare({
    name: "search",
    description: "Searches for a query",
    ArgumentsSchema: t.subtype({ query: t.str }),
  })
  .define(async () => ({
    validate: async (_signal, _transport, { parsed }) =>
      parsed.arguments.query === "invalid" ? err("invalid query") : ok(null),
    run: async ({ toolCall, data }) => {
      data.executed.push(toolCall.parsed.arguments.query);
      return ok({
        type: "output" as const,
        content: [{ type: "text" as const, content: "search result" }],
      });
    },
  }));

const delegateTool = new ToolBuilder<ToolData>()
  .declare({
    name: "delegate",
    description: "Delegates to research",
    ArgumentsSchema: t.subtype({ task: t.str }),
    subagents: ["research"] as const,
  })
  .define(async () => ({
    run: async ({ toolCall, data }) => {
      data.executed.push("delegate");
      return ok({
        type: "invoke-subagent" as const,
        name: "research" as const,
        message: [{ type: "text" as const, content: toolCall.parsed.arguments.task }],
      });
    },
  }));

const research = definePermissionlessAgent({ tools: { search: searchTool }, agents: {} });
const agent = definePermissionlessAgent({
  tools: { search: searchTool, delegate: delegateTool },
  agents: { research },
});
type TestAgent = typeof agent;
type Scope = "root" | "research";
const scopes: Scope[] = ["root", "research"];
const transport = new LocalTransport();

type Emit = (tokens: string, type: "content" | "reasoning") => Promise<void>;
type Response = (
  emit: Emit,
) =>
  | Result<CompilerSuccessData<TestAgent>, CompilerError>
  | Promise<Result<CompilerSuccessData<TestAgent>, CompilerError>>;

type Snapshot = {
  scope: Scope;
  roles: Array<TreeIR<TestAgent>["role"]>;
  history: string;
};

function assistant(
  content: string,
  toolCalls?: AssistantMessage<TestAgent["tools"]>["toolCalls"],
): AssistantMessage<TestAgent["tools"]> {
  return { role: "assistant", content, toolCalls, usage: compilerUsage(1, 1) };
}

function response(output: AssistantMessage<TestAgent["tools"]>): Response {
  return () => ok({ output, usage: compilerUsage(1, 1), curl: "curl", headers: new Headers() });
}

function searchCall(query: string): ToolCall<TestAgent["tools"]> {
  return {
    type: "tool-call",
    name: "search",
    toolCallId: `search-${query}`,
    original: { query },
    parsed: { query },
  };
}

function malformedCall(): MalformedToolRequest {
  return {
    type: "malformed-tool-request",
    toolCallId: "malformed-search",
    call: { original: { name: "search", arguments: "{oops" } },
    error: "bad JSON",
  };
}

function lowerMessages(messages: Array<LowerInputIR<TestAgent>>): Array<LowerOutputIR<TestAgent>> {
  return messages.map(original => ({ original, converted: original }));
}

async function fixture(messages: Array<AgentIR<TestAgent>>, responses: Response[]) {
  const executed: string[] = [];
  const snapshots: Snapshot[] = [];
  // Mirror the persistence adapter's root records independently of canonical history.
  // Appending a whole group internally is not enough if callbacks still publish it piecemeal.
  const persisted: Array<AgentIR<TestAgent>> = [...messages];
  const compilerCalls: Array<{ scope: Scope; irs: Array<LoweredIR<TestAgent["tools"]>> }> = [];
  const controller = new AbortController();
  const data: ToolData = { executed };
  const loadParams = { signal: controller.signal, transport, data };
  const search = await searchTool(loadParams);
  const delegate = await delegateTool(loadParams);
  if (search == null || delegate == null) throw new Error("Test tools failed to load");
  const queue = [...responses];
  const runCompiler: Compiler<Scope> = async <
    A extends Agent<any, any, any>,
    Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
  >(
    params: CompilerParams<A, Scope, Tools>,
  ): Promise<CompilerResult<A, Tools>> => {
    // The fixture only emits calls from this tree, as in trajectory.test.ts's compiler queue.
    compilerCalls.push({
      scope: params.model,
      irs: JSON.parse(JSON.stringify(params.irs)),
    });
    const next = queue.shift();
    if (next == null) throw new Error("Unexpected compiler call during crash recovery");
    const result = await next(params.onTokens);
    return result as typeof result & CompilerResult<A, Tools>;
  };
  const trajectory = new Trajectory({
    agent,
    messages,
    abortSignal: controller.signal,
    toolData: data,
    transport,
    runCompiler,
    lowerMessages,
    model: async invocation =>
      ok({
        model: invocation == null ? ("root" as const) : ("research" as const),
        contextWindow: 100_000,
        modalities: null,
      }),
    loadTools: async () => ok({ search, delegate }),
    subagentPrompts: { research: async () => "Research the task." },
    toolContentTooLargeError: async () => "Unexpected oversized test output",
    handler: {
      onMessages: event => {
        if (event.root) {
          // Root appends persist the whole commit in one transaction.
          persisted.push(...event.irs);
        } else {
          // Child appends overwrite their containing root record, as in state.ts.
          const index = persisted.indexOf(event.scope.toplevelSubagentIR);
          if (index < 0) throw new Error("Subagent update has no persisted parent record");
          persisted[index] = event.scope.toplevelSubagentIR;
        }
        // Serialize at every callback: retaining live child arrays would let later
        // appends repair an earlier snapshot and conceal the crash window.
        snapshots.push({
          scope: event.root ? "root" : event.subagent,
          roles: event.irs.map(ir => ir.role),
          history: JSON.stringify(persisted),
        });
      },
    },
  });
  return { trajectory, snapshots, executed, compilerCalls };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function recordArc(scope: Scope, responses: Response[]): Promise<Fixture> {
  const delegation = response(
    assistant("", [
      {
        type: "tool-call",
        name: "delegate",
        toolCallId: "research-call",
        original: { task: "Research this" },
        parsed: { task: "Research this" },
      },
    ]),
  );
  const recording = await fixture(
    [{ role: "user", content: [{ type: "text", content: "Do the task" }] }],
    scope === "root" ? responses : [delegation, ...responses],
  );
  await recording.trajectory.step();
  if (scope === "research") await recording.trajectory.step();
  return recording;
}

function snapshotAt(recording: Fixture, scope: Scope, role: Snapshot["roles"][number]): Snapshot {
  const snapshot = recording.snapshots.find(
    snapshot => snapshot.scope === scope && snapshot.roles.includes(role),
  );
  if (snapshot == null) throw new Error(`No ${scope} ${role} persistence boundary was recorded`);
  return snapshot;
}

function inspect(trajectory: Fixture["trajectory"]) {
  const history = [...trajectory.messages];
  const result = inspectHistory(agent, history, downconvert<TestAgent>(lowerMessages)(history));
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function reload(snapshot: Snapshot): Promise<Fixture> {
  const messages: Array<AgentIR<TestAgent>> = JSON.parse(snapshot.history);
  return fixture(messages, [
    response(assistant("recovered")),
    response(assistant("parent recovered")),
  ]);
}

async function runUntilParked(recovered: Fixture): Promise<void> {
  // Stop at real history boundaries instead of aborting the runner: today's exit
  // handler writes cleanup IR, which would change the very snapshot under test.
  // Inspect first so a regression that parks unexpectedly fails an assertion rather
  // than hanging forever inside a step waiting for user input.
  for (let steps = 0; steps < 10; steps++) {
    const { action } = inspect(recovered.trajectory);
    if (action === "wait-for-input" || action === "rectify") return;
    if (!(await recovered.trajectory.step())) return;
  }
  throw new Error("Crash recovery did not reach a parked state within 10 steps");
}

function expectRequestFailure(recovered: Fixture, scope: Scope): void {
  if (scope === "root") {
    const inspection = inspect(recovered.trajectory);
    expect(inspection.action).toBe("rectify");
    expect(inspection.tail?.role).toBe("request-error");
  } else {
    const child = recovered.trajectory.messages.find(ir => ir.role === "subagent-trajectory");
    if (child?.role !== "subagent-trajectory")
      throw new Error("Missing persisted research trajectory");
    expect(recovered.trajectory.inspectSubagentTrajectory(child)).toEqual({
      type: "error",
      error: "connection lost",
    });
  }
}

const failureCases = [
  {
    name: "failed validation",
    call: () => searchCall("invalid"),
    errorRole: "tool-validation-error",
  },
  { name: "malformed call", call: malformedCall, errorRole: "tool-parse-error" },
] as const;

const failedResponse: Response = async emit => {
  await emit("unfinished answer", "content");
  return err({ type: "request-error", requestError: "connection lost", curl: "curl" });
};

describe("trajectory crash recovery at persisted IR boundaries", () => {
  for (const scope of scopes) {
    describe(scope, () => {
      for (const failure of failureCases) {
        it(`never executes a rejected batch when its ${failure.name} assistant is published`, async () => {
          const recording = await recordArc(scope, [
            response(assistant("", [failure.call(), searchCall("skipped-sibling")])),
            response(assistant("done")),
          ]);
          // Exercise the real failed-batch path rather than fabricating invalid history.
          expect(
            recording.snapshots.some(
              snapshot => snapshot.scope === scope && snapshot.roles.includes(failure.errorRole),
            ),
          ).toBe(true);
          const recovered = await reload(snapshotAt(recording, scope, "assistant"));
          await runUntilParked(recovered);

          expect(recovered.executed).toEqual([]);
          expect(recovered.compilerCalls[0]?.scope).toBe(scope);
        });

        it(`continues in the same scope after the complete ${failure.name} retry group is published`, async () => {
          const recording = await recordArc(scope, [
            response(assistant("", [failure.call(), searchCall("skipped-sibling")])),
            response(assistant("done")),
          ]);
          const recovered = await reload(snapshotAt(recording, scope, "tool-skip-output"));
          await runUntilParked(recovered);

          expect(recovered.executed).toEqual([]);
          expect(recovered.compilerCalls[0]?.scope).toBe(scope);
          expect(recovered.compilerCalls[0]?.irs.some(ir => ir.role === failure.errorRole)).toBe(
            true,
          );
        });
      }

      it("does not publish a buffered partial answer as a successful completion before its request error", async () => {
        const recording = await recordArc(scope, [failedResponse]);
        const recovered = await reload(snapshotAt(recording, scope, "assistant"));
        expectRequestFailure(recovered, scope);
        await runUntilParked(recovered);

        expect(recovered.executed).toEqual([]);
        expect(recovered.compilerCalls.map(call => call.scope)).toEqual(
          scope === "root" ? [] : ["root"],
        );
      });

      it("recovers a fully recorded request failure without reexecuting the failed arc", async () => {
        const recording = await recordArc(scope, [failedResponse]);
        const recovered = await reload(snapshotAt(recording, scope, "request-error"));
        expectRequestFailure(recovered, scope);
        await runUntilParked(recovered);

        expect(recovered.executed).toEqual([]);
        expect(recovered.compilerCalls.map(call => call.scope)).toEqual(
          scope === "root" ? [] : ["root"],
        );
        if (scope === "research") {
          expect(recovered.compilerCalls[0].irs).toContainEqual({
            role: "tool-runtime-error",
            toolCall: expect.objectContaining({ toolCallId: "research-call" }),
            error: "connection lost",
          });
        }
      });

      it("executes validated unanswered calls after reload", async () => {
        const recording = await recordArc(scope, [response(assistant("", [searchCall("valid")]))]);
        const recovered = await reload(snapshotAt(recording, scope, "assistant"));
        await runUntilParked(recovered);

        expect(recovered.executed).toEqual(["valid"]);
        expect(recovered.compilerCalls.map(call => call.scope)).toEqual(
          scope === "root" ? ["root"] : ["research", "root"],
        );
      });

      it("does not rerun a recorded result or delegation when later calls remain unanswered", async () => {
        const recording = await recordArc(scope, [
          response(assistant("", [searchCall("recorded"), searchCall("pending")])),
          response(assistant("done")),
        ]);
        await recording.trajectory.step();
        const snapshot = snapshotAt(recording, scope, "tool-output");
        const recovered = await reload(snapshot);
        await runUntilParked(recovered);

        expect(recovered.executed).toEqual(["pending"]);
        expect(recovered.compilerCalls.map(call => call.scope)).toEqual(
          scope === "root" ? ["root"] : ["research", "root"],
        );
      });
    });
  }

  it("leaves a fully recorded root answer parked without executing anything", async () => {
    const recording = await recordArc("root", [response(assistant("done"))]);
    const recovered = await reload(snapshotAt(recording, "root", "assistant"));
    await runUntilParked(recovered);

    expect(inspect(recovered.trajectory).action).toBe("wait-for-input");
    expect(recovered.compilerCalls).toEqual([]);
    expect(recovered.executed).toEqual([]);
  });
});
