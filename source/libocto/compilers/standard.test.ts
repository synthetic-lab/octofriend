import { describe, expect, it } from "bun:test";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { octoAgent } from "../../ir/octo-ir.ts";
import { compilerUsage } from "./compiler-interface.ts";
import { toLlmMessages } from "./standard.ts";
import type { LoweredIR, MalformedToolRequest } from "../llm-ir.ts";
import type { ToolCall } from "../tool-def.ts";
import type toolMap from "../../tools/tool-defs/index.ts";

type Ir = LoweredIR<typeof toolMap>;
type ShellToolCall = Extract<ToolCall<typeof toolMap>, { name: "shell" }>;

function shellCall(id: string): ShellToolCall {
  return {
    type: "tool-call",
    name: "shell",
    toolCallId: id,
    original: { cmd: "ls", timeout: 60_000 },
    parsed: { cmd: "ls", timeout: 60_000 },
  };
}

function malformedShellRequest(): MalformedToolRequest {
  return {
    type: "malformed-tool-request",
    toolCallId: "call_malformed",
    error: "Syntax error: invalid JSON in tool call arguments",
    call: {
      original: {
        name: "shell",
        // Unterminated JSON, as streamed from the model before JSON parsing failed
        arguments: '{"cmd": "ls",',
      },
    },
  };
}

describe("toLlmMessages malformed tool requests", () => {
  /*
   * Regression tests for Kimi K3 400s:
   *   "Error from inference backend: 400 Kimi K3 tool messages need a resolvable tool
   *    name: carry `tool`/`name`, or match a preceding assistant tool_call by order."
   *
   * A malformed tool call produces an assistant IR carrying a malformed-tool-request plus a
   * tool-parse-error IR answering the same call ID. The malformed call's arguments may be
   * unparseable (e.g. a connection died mid-stream, leaving half a JSON string), so it must NOT
   * be re-emitted as an assistant tool_call — and since it isn't, its tool-parse-error must NOT
   * be emitted as a tool message either: backends hard-reject tool messages whose tool_call_id
   * doesn't match a preceding assistant tool_call. The parse failure is delivered as a user
   * message instead.
   */
  it("drops malformed tool requests from tool_calls and delivers the parse error as a user message", async () => {
    const malformed = malformedShellRequest();
    const irs: Ir[] = [
      { role: "user", content: [{ type: "text", content: "run ls" }] },
      {
        role: "assistant",
        content: "",
        usage: compilerUsage(0, 0),
        toolCalls: [malformed],
      },
      { role: "tool-parse-error", malformedRequest: malformed },
    ];

    const messages = await toLlmMessages<typeof octoAgent>(irs);
    expect(messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);

    const assistant = messages[1] as ChatCompletionAssistantMessageParam;
    expect(assistant.tool_calls == null || assistant.tool_calls.length === 0).toBe(true);

    // No tool message may reference the malformed call...
    expect(messages.filter(m => m.role === "tool")).toEqual([]);

    // ...and the parse failure reaches the model as a user message.
    const errorMessage = messages[2];
    expect(errorMessage.role).toBe("user");
    const text = JSON.stringify(errorMessage.content);
    expect(text).toContain("Syntax error: invalid JSON in tool call arguments");
  });

  it("handles mixed valid and malformed calls in one assistant turn", async () => {
    const malformed = malformedShellRequest();
    const valid = shellCall("call_valid");
    const irs: Ir[] = [
      { role: "user", content: [{ type: "text", content: "run ls" }] },
      {
        role: "assistant",
        content: "",
        usage: compilerUsage(0, 0),
        toolCalls: [valid, malformed],
      },
      {
        role: "tool-output",
        toolCall: valid,
        content: [{ type: "text", content: "file.txt" }],
      },
      { role: "tool-parse-error", malformedRequest: malformed },
    ];

    const messages = await toLlmMessages<typeof octoAgent>(irs);

    const assistant = messages.find(m => m.role === "assistant") as
      | ChatCompletionAssistantMessageParam
      | undefined;
    expect(assistant).toBeDefined();
    // The valid call is kept; the malformed one is not re-emitted.
    expect(assistant!.tool_calls).toEqual([
      {
        type: "function",
        id: "call_valid",
        function: {
          name: "shell",
          arguments: JSON.stringify(valid.original),
        },
      },
    ]);

    // Every tool message resolves to a preceding assistant tool_call.
    const precedingCallIds: string[] = [];
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const toolCall of (message as ChatCompletionAssistantMessageParam).tool_calls ?? []) {
          precedingCallIds.push(toolCall.id);
        }
      }
      if (message.role === "tool") {
        const toolCallId = (message as ChatCompletionToolMessageParam).tool_call_id;
        expect(
          precedingCallIds,
          `tool message with tool_call_id ${JSON.stringify(toolCallId)} has no matching preceding assistant tool_call`,
        ).toContain(toolCallId);
      }
    }
    expect(precedingCallIds).toContain("call_valid");
    expect(precedingCallIds).not.toContain("call_malformed");

    // The malformed call's failure reaches the model as a user message.
    const errorMessage = messages.filter(m => m.role === "user").at(-1);
    expect(JSON.stringify(errorMessage?.content)).toContain("Syntax error");
  });
});
