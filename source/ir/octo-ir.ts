import type { Result } from "../result.ts";
import toolMap from "../tools/tool-defs/index.ts";
import {
  Content,
  defineAgent,
  MalformedToolRequest,
  AssistantMessage,
  ToolValidationErrorMessage,
} from "../libocto/llm-ir.ts";
import type { LlmIR } from "../libocto/llm-ir.ts";
import type { ToolCall } from "../libocto/tool-def.ts";

export const octoAgent = defineAgent({
  tools: toolMap,
  agents: {},
});

export type OctoIR = LlmIR<typeof octoAgent>;
export type TrajectoryOutputIR =
  | AssistantMessage<typeof toolMap>
  | {
      role: "tool-parse-error";
      malformedRequest: MalformedToolRequest;
    }
  | ToolValidationErrorMessage<typeof toolMap>
  | {
      role: "tool-skip-output";
      toolCall: ToolCall<typeof toolMap>;
      reason: string;
    }
  | Extract<LlmIR<typeof octoAgent>, { role: "file-read" | "file-mutate" }>
  | {
      role: "checkpoint";
      content: Content["content"];
    };

export type AgentResult = Result<
  {
    output: AssistantMessage<typeof toolMap>;
    curl: string;
  },
  {
    requestError: string;
    curl: string;
  }
>;
