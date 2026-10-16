import { describe, expect, it } from "bun:test";
import { t } from "structural";
import type { Content, LoweredIR, PreLoweredIR } from "./llm-ir.ts";
import { definePermissionedAgent, definePermissionlessAgent } from "./llm-ir.ts";
import { lower } from "./lower.ts";
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

const _grandchildAgent = definePermissionlessAgent({
  tools: { search: searchTool },
  agents: {},
});
type GrandchildAgent = typeof _grandchildAgent;

const _researchAgent = definePermissionlessAgent({
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

type TestIR = PreLoweredIR<TestAgent>;
type ResearchIR = PreLoweredIR<ResearchAgent>;
type GrandchildIR = PreLoweredIR<GrandchildAgent>;
type TestLoweredIR = LoweredIR<TestAgent["tools"]>;

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

function subagentTrajectory(ir: ResearchIR[], toolCall: ToolCall<TestAgent["tools"]>): TestIR {
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

function checkpointSummary(message: TestIR | TestLoweredIR): string {
  if (message.role !== "checkpoint" && message.role !== "lowered-checkpoint") {
    throw new Error("Expected checkpoint");
  }
  return contentToText(message.content);
}

function userText(message: TestIR | TestLoweredIR): string {
  if (message.role !== "user") throw new Error("Expected user message");
  return contentToText(message.content);
}

function assistantText(message: TestIR | TestLoweredIR): string {
  if (message.role !== "assistant") throw new Error("Expected assistant message");
  return message.content;
}

function contentToText(content: Content["content"]): string {
  return content
    .map(part => {
      if (part.type === "text") return part.content;
      return `Image file: ${part.image.filePath}`;
    })
    .join("\n");
}

function roles(messages: Array<{ role: string }>): string[] {
  return messages.map(m => m.role);
}

describe("lower", () => {
  it("passes through lowered IR", () => {
    const messages: TestIR[] = [userMessage("hello")];

    expect(lower<TestAgent>(messages)).toEqual<TestIR[]>(messages);
  });

  it("drops subagent invocation annotations", () => {
    const call = searchCall("call-1");
    const messages: TestIR[] = [
      assistantMessage("I'll research this", [call]),
      subagentInvocation(call),
      userMessage("and then I'll do more"),
    ];

    expect(roles(lower<TestAgent>(messages))).toEqual(["assistant", "user"]);
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

    expect(roles(lower<TestAgent>(messages))).toEqual(["user", "assistant"]);
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

    const lowered = lower<TestAgent>(messages);

    expect(roles(lowered)).toEqual(["user", "assistant", "tool-output"]);
    const output = lowered[2];
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

    const lowered = lower<TestAgent>(messages);

    expect(roles(lowered)).toEqual(["user", "assistant", "tool-runtime-error"]);
    const error = lowered[2];
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
      const lowered = lower<TestAgent>([
        userMessage("research IRs"),
        assistantMessage("Researching", [call]),
        subagentInvocation(call),
        subagentTrajectory([researchUserMessage("Research how to lower IRs."), tail], call),
      ]);

      expect(roles(lowered)).toEqual(["user", "assistant", "tool-runtime-error"]);
      const error = lowered[2];
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

    const lowered = lower<TestAgent>(messages);

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

    const lowered = lower<TestAgent>(messages);

    expect(roles(lowered)).toEqual(["user", "assistant"]);
    expect(userText(lowered[0])).toBe("Research nested lowering");
    expect(assistantText(lowered[1])).toBe("Starting the nested search");
  });

  it("answers a historical running trajectory with a never-completed error", () => {
    const lowered = lower<TestAgent>(unfinishedHistory());

    expect(roles(lowered)).toEqual(["user", "assistant", "tool-runtime-error", "user"]);
    const error = lowered[2];
    if (error.role !== "tool-runtime-error") throw new Error("impossible");
    expect(error.error).toBe("The subagent never completed.");
  });

  it("throws on a historical running trajectory in canary builds", () => {
    const prevCanary = process.env["CANARY_OCTO"];
    process.env["CANARY_OCTO"] = "1";
    try {
      expect(() => lower<TestAgent>(unfinishedHistory())).toThrow(
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

      expect(lower<TestAgent>(messages)).toEqual<TestIR[]>(messages);
    });

    it("keeps a single checkpoint and following messages", () => {
      const messages: TestIR[] = [
        userMessage("Hello"),
        assistantMessage("Hi there"),
        checkpointMessage("Summary of early conversation"),
        userMessage("How are you?"),
        assistantMessage("I'm good"),
      ];

      const lowered = lower<TestAgent>(messages);

      expect(lowered.length).toBe(3);
      expect(lowered.filter(m => m.role === "lowered-checkpoint").length).toBe(1);
      expect(roles(lowered)).not.toContain("checkpoint");
      expect(checkpointSummary(lowered[0])).toBe("Summary of early conversation");
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

      const lowered = lower<TestAgent>(messages);

      expect(lowered.length).toBe(3);
      expect(lowered.filter(m => m.role === "lowered-checkpoint").length).toBe(1);
      expect(roles(lowered)).not.toContain("checkpoint");
      expect(checkpointSummary(lowered[0])).toBe("Third checkpoint");
      expect(
        lowered.every(
          m => m.role !== "lowered-checkpoint" || checkpointSummary(m) !== "First checkpoint",
        ),
      ).toBe(true);
      expect(
        lowered.every(
          m => m.role !== "lowered-checkpoint" || checkpointSummary(m) !== "Second checkpoint",
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

      const lowered = lower<TestAgent>(messages);
      const userMessages = lowered.filter(m => m.role === "user");

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

      const lowered = lower<TestAgent>(messages);

      expect(lowered.length).toBe(1);
      expect(checkpointSummary(lowered[0])).toBe("Latest checkpoint");
    });
  });

  it("lowers a tool-reject to a skip output", () => {
    const messages: Array<PreLoweredIR<TestAgent>> = [
      assistantMessage("Searching for something", [
        searchCall("call-1", "embarrassing search history"),
      ]),
      {
        role: "tool-reject",
        toolCall: searchCall("call-1", "embarrassing search history"),
      },
      userMessage("Please don't search for that"),
    ];

    const lowered = lower<TestAgent>(messages);

    expect(roles(lowered)).toEqual(["assistant", "tool-skip-output", "user"]);
    const skip = lowered[1];
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.toolCall.toolCallId).toBe("call-1");
    expect(skip.reason).toBe("Tool call rejected by user.");
  });
});
