import { ChatCompletionCreateParams } from "openai/resources";
import { ToolCall } from "../tools/index.ts";
import { ImageInfo } from "../utils/image-utils.ts";
import { ResponseStreamParams } from "openai/lib/responses/ResponseStream.mjs";
import { MessageCreateParams } from "@anthropic-ai/sdk/resources";

export type ToolCallRequest = {
  type: "tool-request";
  call: ToolCall;
  toolCallId: string;
};

export type MalformedRequest = {
  type: "malformed-request";
  error: string;
  call: {
    original: {
      name: string;
      arguments: any;
    };
  };
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
  toolCalls?: Array<ToolCallRequest | MalformedRequest>;
  tokenUsage: number;
  outputTokens: number;
};

export type UserMessage = {
  role: "user";
  content: string;
  images?: ImageInfo[];
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
  image?: ImageInfo;
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
  toolCall: ToolCallRequest;
  error: string;
};

export type ToolValidationErrorMessage = {
  role: "tool-validation-error";
  toolCall: ToolCallRequest;
  error: string;
  aborted?: boolean;
};

export type ToolSkipMessage = {
  role: "tool-skip";
  toolCall: ToolCallRequest;
  reason: string;
};

export type ToolMalformedMessage = {
  role: "tool-malformed";
  malformedRequest: MalformedRequest;
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

export type InputIR =
  | UserMessage
  | ToolOutputMessage
  | ToolMalformedMessage
  | FileReadMessage
  | FileMutateMethod
  | ToolRejectMessage
  | ToolErrorMessage
  | ToolSkipMessage
  | FileOutdatedMessage
  | FileUnreadableMessage
  | CompactionCheckpoint;

export type LlmIR = AssistantMessage | ToolValidationErrorMessage | InputIR;

export type TrajectoryOutputIR =
  | AssistantMessage
  | ToolMalformedMessage
  | ToolValidationErrorMessage
  | ToolSkipMessage
  | FileOutdatedMessage
  | FileUnreadableMessage
  | CompactionCheckpoint;

export type StandardRequestDetails = {
  type: "standard";
  baseUrl: string;
  body: ChatCompletionCreateParams;
};

export type ResponsesRequestDetails = {
  type: "responses";
  baseUrl: string;
  body: ResponseStreamParams;
};

export type AnthropicRequestDetails = {
  type: "anthropic";
  baseUrl: string;
  body: MessageCreateParams;
};

export type RequestDetails =
  | StandardRequestDetails
  | ResponsesRequestDetails
  | AnthropicRequestDetails;

export type AgentResult =
  | {
      success: true;
      output: AssistantMessage;
      requestDetails: RequestDetails;
    }
  | {
      success: false;
      requestError: string;
      requestDetails: RequestDetails;
    };
