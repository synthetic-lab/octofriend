import { describe, expect, it } from "bun:test";
import { t } from "structural";
import type { AgentIR, Content, CompilerReadyIR, LowerOutputIR, TreeIR } from "./llm-ir.ts";
import { definePermissionedAgent, definePermissionlessAgent } from "./llm-ir.ts";
import {
  activeHistory,
  downconvert,
  isTrajectoryRunning,
  lower,
  pendingToolCalls,
} from "./ir-operations.ts";
import { ok } from "./result.ts";
import { ToolBuilder } from "./tool-def.ts";
import type { ToolCall } from "./tool-def.ts";

const searchTool = new ToolBuilder<unknown>()
  .declare({
    name: "search",
    description: "Searches the web",
    ArgumentsSchema: t.subtype({ query: t.str }),
  })
  .define(async () => ({
    run: async () => ok({ type: "output" as const, content: [] }),
  }));

// The capability is uniform down the tree, so this tree is permissioned to its leaves.
const _grandchildAgent = definePermissionedAgent({
  tools: { search: searchTool },
  agents: {},
});
type GrandchildAgent = typeof _grandchildAgent;

const _researchAgent = definePermissionedAgent({
  tools: { search: searchTool },
  agents: {
    grandchild: _grandchildAgent,
  },
});
type ResearchAgent = typeof _researchAgent;

const _testAgent = definePermissionedAgent({
  tools: { search: searchTool },
  agents: {
    research: _researchAgent,
  },
});
type TestAgent = typeof _testAgent;

type TestIR = AgentIR<TestAgent>;
type ResearchIR = AgentIR<ResearchAgent>;
type GrandchildIR = AgentIR<GrandchildAgent>;
type TestLoweredIR = CompilerReadyIR<TestAgent>;

const convert = downconvert<TestAgent>(messages =>
  messages.map(original => ({ original, converted: original })),
);

function lowerHistory(messages: TestIR[]): TestLoweredIR[] {
  return lower<TestAgent>(convert(messages));
}

function pendingCalls(messages: TestIR[]): Array<ToolCall<TestAgent["tools"]>> {
  return pendingToolCalls<TestAgent>(convert(messages));
}

function trajectoryRunning(trajectory: Extract<TestIR, { role: "subagent-trajectory" }>): boolean {
  const { converted } = convert([trajectory])[0];
  if (converted.role !== "subagent-trajectory") throw new Error("Expected trajectory");
  return isTrajectoryRunning(converted);
}

function searchCall(toolCallId: string, query: string = "cats"): ToolCall<TestAgent["tools"]> {
  return {
    type: "tool-call",
    name: "search",
    toolCallId,
    original: { query },
    parsed: { query },
  };
}

function userMessage(content: string): TestIR {
  return {
    role: "user",
    content: [{ type: "text", content }],
  };
}

function assistantMessage(
  content: string,
  toolCalls: Array<ToolCall<TestAgent["tools"]>> = [],
  tokenUsage: number = 10,
): TestIR {
  return {
    role: "assistant",
    content,
    usage: {
      input: {
        cached: 0,
        uncached: tokenUsage,
        total: tokenUsage,
      },
      output: 0,
    },
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function researchUserMessage(content: string): ResearchIR {
  return {
    role: "user",
    content: [{ type: "text", content }],
  };
}
function researchAssistantMessage(
  content: string,
  toolCall: ToolCall<TestAgent["tools"]>,
): ResearchIR {
  return {
    role: "assistant",
    content,
    toolCalls: [toolCall],
    usage: {
      input: {
        cached: 0,
        uncached: 0,
        total: 0,
      },
      output: 0,
    },
  };
}
function researchAssistantResponse(content: string): ResearchIR {
  return {
    role: "assistant",
    content,
    usage: {
      input: {
        cached: 0,
        uncached: 0,
        total: 0,
      },
      output: 0,
    },
  };
}
function researchInvocation(toolCall: ToolCall<TestAgent["tools"]>): ResearchIR {
  return {
    role: "tool-invoke-subagent",
    toolCall,
    subagent: "grandchild",
    message: [{ type: "text", content: "Research nested lowering" }],
  };
}
function researchTrajectory(
  ir: GrandchildIR[],
  toolCall: ToolCall<TestAgent["tools"]>,
): ResearchIR {
  return {
    role: "subagent-trajectory",
    subagent: "grandchild",
    ir,
    toolCall,
  };
}
function grandchildUserMessage(content: string): GrandchildIR {
  return {
    role: "user",
    content: [{ type: "text", content }],
  };
}
function grandchildAssistantMessage(content: string): GrandchildIR {
  return {
    role: "assistant",
    content,
    toolCalls: [searchCall("call-gg-1")],
    usage: {
      input: {
        cached: 0,
        uncached: 0,
        total: 0,
      },
      output: 0,
    },
  };
}

function checkpointMessage(summary: string): TestIR {
  return {
    role: "checkpoint",
    content: [{ type: "text", content: summary }],
  };
}

function subagentInvocation(toolCall: ToolCall<TestAgent["tools"]>): TestIR {
  return {
    role: "tool-invoke-subagent",
    toolCall,
    subagent: "research",
    message: [{ type: "text", content: "Research how to lower IRs." }],
  };
}

function subagentTrajectory(
  ir: ResearchIR[],
  toolCall: ToolCall<TestAgent["tools"]>,
): Extract<TestIR, { role: "subagent-trajectory" }> {
  return {
    role: "subagent-trajectory",
    subagent: "research",
    ir,
    toolCall,
  };
}

function unfinishedHistory(): TestIR[] {
  const call = searchCall("call-1");
  const innerCall = searchCall("call-cc-1");
  return [
    userMessage("this conversation continued after a stalled flight"),
    assistantMessage("Researching", [call]),
    subagentInvocation(call),
    subagentTrajectory(
      [
        researchUserMessage("Research how to lower IRs."),
        researchAssistantMessage("Starting the search", innerCall),
      ],
      call,
    ),
    userMessage("and this arrived after the stall"),
  ];
}

function checkpointSummary({ converted }: TestLoweredIR): string {
  if (converted.role !== "lowered-checkpoint") throw new Error("Expected checkpoint");
  return contentToText(converted.content);
}

function userText({ converted }: TestLoweredIR): string {
  if (converted.role !== "user") throw new Error("Expected user message");
  return contentToText(converted.content);
}

function assistantText({ converted }: TestLoweredIR): string {
  if (converted.role !== "assistant") throw new Error("Expected assistant message");
  return converted.content;
}

function contentToText(content: Content["content"]): string {
  return content
    .map(part => {
      if (part.type === "text") return part.content;
      return `Image file: ${part.image.filePath}`;
    })
    .join("\n");
}

function roles(messages: TestLoweredIR[]): string[] {
  return messages.map(({ converted }) => converted.role);
}

describe("activeHistory", () => {
  it("selects the root for empty history or an ordinary tail", () => {
    const empty: TestIR[] = [];
    expect(activeHistory(_testAgent, empty, convert(empty))).toEqual({
      root: true,
      agent: _testAgent,
      history: empty,
    });

    const child = subagentTrajectory([], searchCall("child"));
    const history: TestIR[] = [child, userMessage("a later turn")];
    const location = activeHistory(_testAgent, history, convert(history));
    expect(location.root).toBe(true);
    expect(location.history === history).toBe(true);
    expect(history[0]).toBe(child);
  });

  it("selects an empty child and returns its live history and trajectory", () => {
    const child = subagentTrajectory([], searchCall("child"));
    const history: TestIR[] = [child];
    const location = activeHistory(_testAgent, history, convert(history));
    if (location.root || location.subagent !== "research") throw new Error("Expected research");
    expect(location.agent).toBe(_researchAgent);
    expect(location.history).toBe(child.ir);
    expect(location.scope.parentSubagentIR).toBe(child);
    expect(location.scope.toplevelSubagentIR).toBe(child);
    expect(location.scope.path).toEqual([{ subagent: "research", toolCallId: "child" }]);
    expect(child.ir).toEqual([]);
    location.history.push(researchUserMessage("go"));
    expect(child.ir).toEqual([researchUserMessage("go")]);
    expect(history).toEqual([child]);
  });

  it("walks to the deepest running child, then returns to each parent as children finish", () => {
    const nested: Extract<ResearchIR, { role: "subagent-trajectory" }> = {
      role: "subagent-trajectory",
      subagent: "grandchild",
      toolCall: searchCall("nested"),
      ir: [grandchildUserMessage("go")],
    };
    const child = subagentTrajectory([nested], searchCall("outer"));
    const history: TestIR[] = [child];
    const deepest = activeHistory(_testAgent, history, convert(history));
    if (deepest.root || deepest.subagent !== "grandchild") throw new Error("Expected grandchild");
    expect(deepest.agent).toBe(_grandchildAgent);
    expect(deepest.history).toBe(nested.ir);
    expect(deepest.scope.parentSubagentIR).toBe(nested);
    expect(deepest.scope.toplevelSubagentIR).toBe(child);
    expect(deepest.scope.path).toEqual([
      { subagent: "research", toolCallId: "outer" },
      { subagent: "grandchild", toolCallId: "nested" },
    ]);
    deepest.history.push({
      role: "assistant",
      content: "finished nested work",
      toolCalls: [],
      usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
    });

    const parent = activeHistory(_testAgent, history, convert(history));
    if (parent.root || parent.subagent !== "research") throw new Error("Expected research");
    expect(parent.history).toBe(child.ir);
    expect(parent.scope.parentSubagentIR).toBe(child);
    expect(parent.scope.path).toEqual([{ subagent: "research", toolCallId: "outer" }]);
    parent.history.push(researchAssistantResponse("finished outer work"));

    const root = activeHistory(_testAgent, history, convert(history));
    expect(root.root).toBe(true);
    expect(root.history === history).toBe(true);
    expect(child.ir[0]).toBe(nested);
    expect(history).toHaveLength(1);
  });

  it("uses paired originals rather than matching converted and raw array positions", () => {
    const before = userMessage("expand");
    const child = subagentTrajectory([researchUserMessage("go")], searchCall("child"));
    const history: TestIR[] = [before, child];
    const expanded = downconvert<TestAgent>(messages =>
      messages.flatMap(original => {
        const pair = { original, converted: original };
        return original === before ? [pair, pair] : [pair];
      }),
    )(history);
    expect(expanded).toHaveLength(3);
    const location = activeHistory(_testAgent, history, expanded);
    if (location.root) throw new Error("Expected child");
    expect(location.history === child.ir).toBe(true);
    expect(location.scope.parentSubagentIR === child).toBe(true);
    expect(history).toEqual([before, child]);
  });
});

describe("pendingToolCalls", () => {
  it("preserves call order and returns the original unanswered calls", () => {
    const calls = [searchCall("c1"), searchCall("c2"), searchCall("c3")];
    const history: TestIR[] = [
      assistantMessage("search", calls),
      { role: "tool-output", toolCall: calls[1], content: [] },
    ];
    const pending = pendingCalls(history);
    expect(pending).toEqual([calls[0], calls[2]]);
    expect(pending[0]).toBe(calls[0]);
    expect(pendingCalls([])).toEqual([]);
  });

  it("recognizes tool errors, skips, and rejections as answers", () => {
    const call = searchCall("c1");
    const answers: TestIR[] = [
      { role: "tool-output", toolCall: call, content: [] },
      { role: "tool-runtime-error", toolCall: call, error: "failed" },
      { role: "tool-validation-error", toolCall: call, error: "invalid", aborted: false },
      { role: "tool-skip-output", toolCall: call, reason: "skipped" },
      { role: "tool-reject", toolCall: call },
    ];
    for (const answer of answers) {
      expect(pendingCalls([assistantMessage("search", [call]), answer])).toEqual([]);
    }
  });

  it("does not reuse answers from an earlier batch with the same call ID", () => {
    const oldCall = searchCall("c1", "old");
    const newCall = searchCall("c1", "new");
    expect(
      pendingCalls([
        assistantMessage("old search", [oldCall]),
        { role: "tool-output", toolCall: oldCall, content: [] },
        assistantMessage("new search", [newCall]),
      ]),
    ).toEqual([newCall]);
  });

  it("does not cross user, checkpoint, or assistant-response boundaries", () => {
    const call = searchCall("c1");
    for (const boundary of [
      userMessage("new turn"),
      checkpointMessage("summary"),
      assistantMessage("done"),
    ]) {
      expect(pendingCalls([assistantMessage("search", [call]), boundary])).toEqual([]);
    }
  });

  it("leaves a delegation pending until its trajectory becomes terminal", () => {
    const call = searchCall("c1");
    const child = subagentTrajectory([researchUserMessage("go")], call);
    const history: TestIR[] = [assistantMessage("delegate", [call]), subagentInvocation(call)];
    expect(pendingCalls(history)).toEqual([call]);
    history.push(child);
    expect(pendingCalls(history)).toEqual([call]);
    child.ir.push(researchAssistantResponse("done"));
    expect(pendingCalls(history)).toEqual([]);
  });

  it("does not confuse descendant answers with parent answers", () => {
    const delegated = searchCall("c1");
    const pending = searchCall("c2");
    const child = subagentTrajectory(
      [
        researchUserMessage("go"),
        researchAssistantMessage("child search", pending),
        { role: "tool-output", toolCall: pending, content: [] },
        researchAssistantResponse("done"),
      ],
      delegated,
    );
    expect(
      pendingCalls([assistantMessage("delegate then search", [delegated, pending]), child]),
    ).toEqual([pending]);
  });

  it("never returns malformed tool requests as runnable calls", () => {
    const call = searchCall("c1");
    const message: TestIR = {
      role: "assistant",
      content: "",
      usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
      toolCalls: [
        {
          type: "malformed-tool-request",
          toolCallId: "bad",
          error: "invalid JSON",
          call: { original: { name: "search", arguments: "{" } },
        },
        call,
      ],
    };
    expect(pendingCalls([message])).toEqual([call]);
  });
});

describe("downconvert", () => {
  it("keeps trajectories out of the callback and preserves run boundaries", () => {
    const before = userMessage("expand");
    const dropped = userMessage("drop");
    const after = userMessage("after");
    const childBefore = researchUserMessage("child before");
    const childAfter = researchUserMessage("child after");
    const deepest = grandchildUserMessage("deepest");
    const nested = researchTrajectory([deepest], searchCall("nested"));
    const child = subagentTrajectory([childBefore, nested, childAfter], searchCall("child"));
    const empty = subagentTrajectory([], searchCall("empty"));
    const runs: Array<Array<TreeIR<TestAgent>>> = [];
    const convert = downconvert<TestAgent>(messages => {
      runs.push(messages);
      const output: Array<LowerOutputIR<TestAgent>> = [];
      for (const original of messages) {
        if (original === dropped) continue;
        output.push({ original, converted: original });
        if (original === before) output.push({ original, converted: original });
      }
      return output;
    });

    const result = convert([before, dropped, child, empty, after]);
    expect(runs.map(run => run.map(ir => ir.role))).toEqual([
      ["user", "user"],
      ["user"],
      ["user"],
      ["user"],
      ["user"],
    ]);
    expect(runs[0][0]).toBe(before);
    expect(runs[0][1]).toBe(dropped);
    expect(runs[1][0]).toBe(childBefore);
    expect(runs[2][0]).toBe(deepest);
    expect(runs[3][0]).toBe(childAfter);
    expect(runs[4][0]).toBe(after);
    expect(runs.flat().map(ir => ir.role)).not.toContain("subagent-trajectory");
    expect(result.map(pair => pair.original)).toEqual([before, before, child, empty, after]);
    expect(result[2].original).toBe(child);
    expect(result[3].original).toBe(empty);
    const convertedChild = result[2].converted;
    if (convertedChild.role !== "subagent-trajectory") throw new Error("Expected trajectory");
    expect(convertedChild.ir.map(pair => pair.original)).toEqual([childBefore, nested, childAfter]);
    expect(convertedChild.ir[1].original).toBe(nested);
    expect(child.ir).toEqual([childBefore, nested, childAfter]);
    expect(empty.ir).toEqual([]);
    expect(convert([])).toEqual([]);
    expect(runs).toHaveLength(5);
  });

  it("preserves provenance when a client drops and expands messages", () => {
    const dropped = userMessage("drop");
    const expanded = userMessage("expand");
    const convert = downconvert<TestAgent>(messages => {
      const pairs: Array<LowerOutputIR<TestAgent>> = [];
      for (const original of messages) {
        if (original === dropped) continue;
        pairs.push(
          { original, converted: { role: "user", content: [{ type: "text", content: "first" }] } },
          { original, converted: { role: "user", content: [{ type: "text", content: "second" }] } },
        );
      }
      return pairs;
    });

    const recursive = convert([dropped, expanded]);
    const ready = lower<TestAgent>(recursive);
    expect(ready.length).toBe(2);
    for (let index = 0; index < ready.length; index++) {
      expect(recursive[index].original).toBe(expanded);
      expect(ready[index].original).toBe(expanded);
      expect(ready[index].converted === recursive[index].converted).toBe(true);
    }
    expect(ready.map(userText)).toEqual(["first", "second"]);
  });

  it("converts nested extras for inspection without replacing the live tree", () => {
    const reportTool = new ToolBuilder<unknown>()
      .declare({ name: "report", description: "Reports", ArgumentsSchema: t.subtype({}) })
      .withCustomIR({
        result: toolCall => (args: { text: string; failed: boolean }) => ({
          role: "report-result" as const,
          toolCall,
          ...args,
        }),
      })
      .define(async () => ({
        run: async ({ customIR }) => customIR.result({ text: "done", failed: false }),
      }));
    const leaf = definePermissionlessAgent({ tools: { report: reportTool }, agents: {} });
    const child = definePermissionlessAgent({
      tools: { search: searchTool },
      agents: { grandchild: leaf },
    });
    const _root = definePermissionlessAgent({
      tools: { search: searchTool },
      agents: { research: child },
    });
    const call: ToolCall<(typeof leaf)["tools"]> = {
      type: "tool-call",
      name: "report",
      toolCallId: "c1",
      original: {},
      parsed: {},
    };
    const result = {
      role: "report-result" as const,
      toolCall: call,
      text: "stopped",
      failed: true,
    };
    const nested = {
      role: "subagent-trajectory" as const,
      subagent: "grandchild" as const,
      toolCall: searchCall("child-call"),
      ir: [result],
    };
    const outer = {
      role: "subagent-trajectory" as const,
      subagent: "research" as const,
      toolCall: searchCall("root-call"),
      ir: [nested],
    };
    const raw: Array<AgentIR<typeof _root>> = [outer];
    const convert = downconvert<typeof _root>(messages => {
      const pairs: Array<LowerOutputIR<typeof _root>> = [];
      for (const original of messages) {
        if (original.role !== "report-result") {
          pairs.push({ original, converted: original });
          continue;
        }
        if (original.failed) {
          pairs.push({
            original,
            converted: {
              role: "tool-skip-output",
              toolCall: original.toolCall,
              reason: original.text,
            },
          });
        } else {
          pairs.push({
            original,
            converted: { role: "tool-output", toolCall: original.toolCall, content: [] },
          });
        }
      }
      return pairs;
    });

    const pair = convert(raw)[0];
    const { converted } = pair;
    if (converted.role !== "subagent-trajectory") throw new Error("Expected trajectory");
    const nestedPair = converted.ir[0];
    const convertedNested = nestedPair.converted;
    if (convertedNested.role !== "subagent-trajectory")
      throw new Error("Expected nested trajectory");
    expect(isTrajectoryRunning(convertedNested)).toBe(false);
    // Finishing the grandchild does not finish its caller, which still owes a response.
    expect(isTrajectoryRunning(converted)).toBe(true);
    expect(convertedNested.ir[0].converted.role).toBe("tool-skip-output");
    expect(pair.original).toBe(outer);
    expect(nestedPair.original).toBe(nested);
    expect(convertedNested.ir[0].original).toBe(result);
    const ready = lower<typeof _root>([pair]);
    expect(ready[0].original).toBe(nested);
    expect(ready[0].converted.role).toBe("tool-runtime-error");
    expect(converted).not.toBe(outer);
    expect(convertedNested).not.toBe(nested);
    expect(raw[0]).toBe(outer);
    expect(outer.ir[0]).toBe(nested);
    expect(nested.ir[0]).toBe(result);
    expect(result.role).toBe("report-result");

    // The raw extension looks unchanged, but its converted terminal error closes the grandchild.
    const location = activeHistory(_root, raw, [pair]);
    if (location.root || location.subagent !== "research") throw new Error("Expected research");
    expect(location.agent).toBe(child);
    expect(location.history).toBe(outer.ir);
    expect(location.scope.parentSubagentIR).toBe(outer);
    expect(location.scope.toplevelSubagentIR).toBe(outer);
  });
});

describe("isTrajectoryRunning", () => {
  it("keeps empty trajectories, directives, and pending tools running", () => {
    const call = searchCall("c1");
    for (const history of [
      [],
      [researchUserMessage("go")],
      [researchAssistantMessage("search", call)],
    ]) {
      expect(trajectoryRunning(subagentTrajectory(history, call))).toBe(true);
    }
  });

  it("treats an explicitly empty tool-call array as a terminal response", () => {
    const child = subagentTrajectory(
      [
        {
          role: "assistant",
          content: "done",
          toolCalls: [],
          usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
        },
      ],
      searchCall("c1"),
    );
    expect(trajectoryRunning(child)).toBe(false);
    expect(lowerHistory([child]).map(({ converted }) => converted)).toEqual([
      {
        role: "tool-output",
        toolCall: child.toolCall,
        content: [{ type: "text", content: "done" }],
      },
    ]);
  });

  it("recognizes terminal error and interrupt records", () => {
    const tails: ResearchIR[] = [
      { role: "request-error", requestError: "failed", curl: "curl" },
      { role: "compaction-error", requestError: "failed", curl: null },
      { role: "validation-retry-budget-exceeded", error: "invalid" },
      { role: "interrupted-by-user", reason: "stopped" },
    ];
    for (const tail of tails) {
      expect(trajectoryRunning(subagentTrajectory([tail], searchCall("c1")))).toBe(false);
    }
  });
});

describe("lower", () => {
  it("passes through lowered IR", () => {
    const messages: TestIR[] = [userMessage("hello")];

    const lowered = lowerHistory(messages);
    expect(lowered.length).toBe(messages.length);
    for (let index = 0; index < messages.length; index++) {
      expect(lowered[index].original).toBe(messages[index]);
      expect(lowered[index].converted === messages[index]).toBe(true);
    }
  });

  it("drops subagent invocation annotations", () => {
    const call = searchCall("call-1");
    const messages: TestIR[] = [
      assistantMessage("I'll research this", [call]),
      subagentInvocation(call),
      userMessage("and then I'll do more"),
    ];

    expect(roles(lowerHistory(messages))).toEqual(["assistant", "user"]);
  });

  it("drops top-level error records", () => {
    const messages: TestIR[] = [
      userMessage("go"),
      assistantMessage("partial"),
      { role: "request-error", requestError: "boom", curl: "curl" },
      { role: "compaction-error", requestError: "thud", curl: null },
      { role: "validation-retry-budget-exceeded", error: "budget" },
      { role: "interrupted-by-user", reason: "the user quit" },
    ];

    expect(roles(lowerHistory(messages))).toEqual(["user", "assistant"]);
  });

  it("answers a finished subagent trajectory with its final response", () => {
    const call = searchCall("call-1");
    const messages: TestIR[] = [
      userMessage("research IRs"),
      assistantMessage("Researching", [call]),
      subagentInvocation(call),
      subagentTrajectory(
        [
          researchUserMessage("Research how to lower IRs."),
          researchAssistantResponse("IRs lower to tool output."),
        ],
        call,
      ),
    ];

    const lowered = lowerHistory(messages);

    expect(roles(lowered)).toEqual(["user", "assistant", "tool-output"]);
    expect(lowered[2].original).toBe(messages[3]);
    const output = lowered[2].converted;
    if (output.role !== "tool-output") throw new Error("impossible");
    expect(output.toolCall).toEqual(call);
    expect(output.content).toEqual([{ type: "text", content: "IRs lower to tool output." }]);
  });

  it("answers a failed subagent trajectory with a runtime error", () => {
    const call = searchCall("call-1");
    const childSkip: ResearchIR = {
      role: "tool-skip-output",
      toolCall: searchCall("call-cc-1"),
      reason: "The subagent was interrupted",
    };
    const messages: TestIR[] = [
      userMessage("research IRs"),
      assistantMessage("Researching", [call]),
      subagentInvocation(call),
      subagentTrajectory([researchUserMessage("Research how to lower IRs."), childSkip], call),
    ];

    const lowered = lowerHistory(messages);

    expect(roles(lowered)).toEqual(["user", "assistant", "tool-runtime-error"]);
    expect(lowered[2].original).toBe(messages[3]);
    const error = lowered[2].converted;
    if (error.role !== "tool-runtime-error") throw new Error("impossible");
    expect(error.toolCall).toEqual(call);
    expect(error.error).toBe("The subagent was interrupted");
  });

  it("answers a subagent that died of an error record with its message", () => {
    const tails: Array<[ResearchIR, string]> = [
      [
        { role: "request-error", requestError: "the model request failed", curl: "curl" },
        "the model request failed",
      ],
      [
        { role: "compaction-error", requestError: "the compaction failed", curl: null },
        "the compaction failed",
      ],
      [
        { role: "validation-retry-budget-exceeded", error: "too many invalid tool calls" },
        "too many invalid tool calls",
      ],
      [
        { role: "interrupted-by-user", reason: "The user interrupted the flight" },
        "The user interrupted the flight",
      ],
    ];

    for (const [tail, message] of tails) {
      const call = searchCall("call-1");
      const lowered = lowerHistory([
        userMessage("research IRs"),
        assistantMessage("Researching", [call]),
        subagentInvocation(call),
        subagentTrajectory([researchUserMessage("Research how to lower IRs."), tail], call),
      ]);

      expect(roles(lowered)).toEqual(["user", "assistant", "tool-runtime-error"]);
      const error = lowered[2].converted;
      if (error.role !== "tool-runtime-error") throw new Error("impossible");
      expect(error.toolCall).toEqual(call);
      expect(error.error).toBe(message);
    }
  });

  it("re-lowers a running subagent trajectory in place of everything before it", () => {
    const call = searchCall("call-1");
    const innerCall = searchCall("call-cc-1");
    const messages: TestIR[] = [
      userMessage("This whole conversation compresses away"),
      assistantMessage("Researching", [call]),
      subagentInvocation(call),
      subagentTrajectory(
        [
          researchUserMessage("Research how to lower IRs."),
          researchAssistantMessage("Starting the search", innerCall),
        ],
        call,
      ),
    ];

    const lowered = lowerHistory(messages);

    expect(roles(lowered)).toEqual(["user", "assistant"]);
    expect(userText(lowered[0])).toBe("Research how to lower IRs.");
    expect(assistantText(lowered[1])).toBe("Starting the search");
  });

  it("re-lowers the deepest nested invocation of a running trajectory", () => {
    const call = searchCall("call-1");
    const innerCall = searchCall("call-cc-1");
    const messages: TestIR[] = [
      userMessage("This whole conversation compresses away"),
      assistantMessage("Researching", [call]),
      subagentInvocation(call),
      subagentTrajectory(
        [
          researchUserMessage("Research how to lower IRs."),
          researchAssistantMessage("Starting the search", innerCall),
          researchInvocation(innerCall),
          researchTrajectory(
            [
              grandchildUserMessage("Research nested lowering"),
              grandchildAssistantMessage("Starting the nested search"),
            ],
            innerCall,
          ),
        ],
        call,
      ),
    ];

    const lowered = lowerHistory(messages);

    expect(roles(lowered)).toEqual(["user", "assistant"]);
    const outer = messages[3];
    if (outer.role !== "subagent-trajectory") throw new Error("Expected trajectory");
    const nested = outer.ir[3];
    if (nested.role !== "subagent-trajectory") throw new Error("Expected nested trajectory");
    expect(lowered[0].original).toBe(nested.ir[0]);
    expect(lowered[1].original).toBe(nested.ir[1]);
    expect(userText(lowered[0])).toBe("Research nested lowering");
    expect(assistantText(lowered[1])).toBe("Starting the nested search");
  });

  it("answers a historical running trajectory with a never-completed error", () => {
    const lowered = lowerHistory(unfinishedHistory());

    expect(roles(lowered)).toEqual(["user", "assistant", "tool-runtime-error", "user"]);
    const error = lowered[2].converted;
    if (error.role !== "tool-runtime-error") throw new Error("impossible");
    expect(error.error).toBe("The subagent never completed.");
  });

  it("throws on a historical running trajectory in canary builds", () => {
    const prevCanary = process.env["CANARY_OCTO"];
    process.env["CANARY_OCTO"] = "1";
    try {
      expect(() => lowerHistory(unfinishedHistory())).toThrow(
        "has IRs after it but no terminal state",
      );
    } finally {
      if (prevCanary == null) delete process.env["CANARY_OCTO"];
      else process.env["CANARY_OCTO"] = prevCanary;
    }
  });

  describe("checkpoint slicing", () => {
    it("keeps all messages when there are no checkpoints", () => {
      const messages: TestIR[] = [
        userMessage("Hello"),
        assistantMessage("Hi there"),
        userMessage("How are you?"),
        assistantMessage("I'm good"),
      ];

      const lowered = lowerHistory(messages);
      expect(lowered.length).toBe(messages.length);
      for (let index = 0; index < messages.length; index++) {
        expect(lowered[index].original).toBe(messages[index]);
        expect(lowered[index].converted === messages[index]).toBe(true);
      }
    });

    it("keeps a single checkpoint and following messages", () => {
      const messages: TestIR[] = [
        userMessage("Hello"),
        assistantMessage("Hi there"),
        checkpointMessage("Summary of early conversation"),
        userMessage("How are you?"),
        assistantMessage("I'm good"),
      ];

      const lowered = lowerHistory(messages);

      expect(lowered.length).toBe(3);
      expect(lowered.filter(m => m.converted.role === "lowered-checkpoint").length).toBe(1);
      expect(roles(lowered)).not.toContain("checkpoint");
      expect(checkpointSummary(lowered[0])).toBe("Summary of early conversation");
      expect(lowered[0].original).toBe(messages[2]);
    });

    it("keeps only the most recent checkpoint and following messages", () => {
      const messages: TestIR[] = [
        userMessage("Message 1"),
        assistantMessage("Response 1", [], 5),
        checkpointMessage("First checkpoint"),
        userMessage("Message 2"),
        assistantMessage("Response 2", [], 5),
        checkpointMessage("Second checkpoint"),
        userMessage("Message 3"),
        assistantMessage("Response 3", [], 5),
        checkpointMessage("Third checkpoint"),
        userMessage("Message 4"),
        assistantMessage("Response 4", [], 5),
      ];

      const lowered = lowerHistory(messages);

      expect(lowered.length).toBe(3);
      expect(lowered.filter(m => m.converted.role === "lowered-checkpoint").length).toBe(1);
      expect(roles(lowered)).not.toContain("checkpoint");
      expect(checkpointSummary(lowered[0])).toBe("Third checkpoint");
      expect(
        lowered.every(
          m =>
            m.converted.role !== "lowered-checkpoint" ||
            checkpointSummary(m) !== "First checkpoint",
        ),
      ).toBe(true);
      expect(
        lowered.every(
          m =>
            m.converted.role !== "lowered-checkpoint" ||
            checkpointSummary(m) !== "Second checkpoint",
        ),
      ).toBe(true);
    });

    it("only keeps new user messages after the latest checkpoint", () => {
      const messages: TestIR[] = [
        userMessage("Old message 1"),
        assistantMessage("Old response 1", [], 5),
        checkpointMessage("Old checkpoint"),
        userMessage("Old message 2"),
        assistantMessage("Old response 2", [], 5),
        checkpointMessage("Recent checkpoint"),
        userMessage("New message 1"),
        assistantMessage("New response 1", [], 5),
        userMessage("New message 2"),
        assistantMessage("New response 2", [], 5),
      ];

      const lowered = lowerHistory(messages);
      const userMessages = lowered.filter(m => m.converted.role === "user");

      expect(userMessages.length).toBe(2);
      expect(userMessages.every(m => userText(m).includes("New"))).toBe(true);
    });

    it("keeps the checkpoint when the checkpoint is at the end", () => {
      const messages: TestIR[] = [
        userMessage("Message 1"),
        assistantMessage("Response 1", [], 5),
        userMessage("Message 2"),
        assistantMessage("Response 2", [], 5),
        checkpointMessage("Latest checkpoint"),
      ];

      const lowered = lowerHistory(messages);

      expect(lowered.length).toBe(1);
      expect(checkpointSummary(lowered[0])).toBe("Latest checkpoint");
    });
  });

  it("lowers a tool-reject to a skip output", () => {
    const messages: TestIR[] = [
      assistantMessage("Searching for something", [
        searchCall("call-1", "embarrassing search history"),
      ]),
      {
        role: "tool-reject",
        toolCall: searchCall("call-1", "embarrassing search history"),
      },
      userMessage("Please don't search for that"),
    ];

    const lowered = lowerHistory(messages);

    expect(roles(lowered)).toEqual(["assistant", "tool-skip-output", "user"]);
    expect(lowered[1].original).toBe(messages[1]);
    const skip = lowered[1].converted;
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.toolCall.toolCallId).toBe("call-1");
    expect(skip.reason).toBe("Tool call rejected by user.");
  });
});
