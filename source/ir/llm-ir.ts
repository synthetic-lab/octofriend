import { ToolCall } from "../tools/index.ts";

export type ToolCallRequest = {
  type: "function";
  function: ToolCall;
  toolCallId: string;
};

export type AnthropicAssistantData = {
  thinkingBlocks: Array<
    | {
        type: "thinking";
        thinking: string;
        signature: string;
      }
    | {
        type: "redacted_thinking";
        data: string;
      }
  >;
};

export type AssistantMessage = {
  role: "assistant";
  content: string;
  reasoningContent?: string | null;
  openai?: {
    encryptedReasoningContent?: string | null;
    reasoningId?: string;
  };
  anthropic?: AnthropicAssistantData;
  toolCall?: ToolCallRequest;
  toolCalls?: ToolCallRequest[]; // For parallel tool calls
  tokenUsage: number;
  outputTokens: number;
};

export type UserMessage = {
  role: "user";
  content: string;
};

export type ToolOutputMessage = {
  role: "tool-output";
  content: string;
  toolCall: ToolCallRequest;
};

export type FileReadMessage = {
  role: "file-read";
  content: string;
  toolCall: ToolCallRequest;
  path: string;
};

export type FileMutateMethod = {
  role: "file-mutate";
  content: string;
  toolCall: ToolCallRequest;
  path: string;
};

export type ToolRejectMessage = {
  role: "tool-reject";
  toolCall: ToolCallRequest;
};

export type ToolErrorMessage = {
  role: "tool-error";
  toolCallId: string;
  toolName: string;
  error: string;
};

export type ToolMalformedMessage = {
  role: "tool-malformed";
  toolCallId: string;
  toolName?: string;
  arguments?: string;
  error: string;
};

export type FileOutdatedMessage = {
  role: "file-outdated";
  toolCall: ToolCallRequest;
  error: string;
};

export type FileUnreadableMessage = {
  role: "file-unreadable";
  path: string;
  toolCall: ToolCallRequest;
  error: string;
};

export type CompactionCheckpoint = {
  role: "compaction-checkpoint";
  summary: string;
};

export type OutputIR = AssistantMessage | ToolMalformedMessage;

export type InputIR =
  | UserMessage
  | ToolOutputMessage
  | FileReadMessage
  | FileMutateMethod
  | ToolRejectMessage
  | ToolErrorMessage
  | FileOutdatedMessage
  | FileUnreadableMessage
  | CompactionCheckpoint;

export type LlmIR = OutputIR | InputIR;

export type TrajectoryOutputIR =
  | OutputIR
  | ToolErrorMessage
  | FileOutdatedMessage
  | FileUnreadableMessage
  | CompactionCheckpoint;

export type AgentResult =
  | {
      success: true;
      output: OutputIR[];
      curl: string;
    }
  | {
      success: false;
      requestError: string;
      curl: string;
    };
