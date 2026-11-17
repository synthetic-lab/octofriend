import type Anthropic from "@anthropic-ai/sdk";
import { t } from "structural";
import type { Protocol, ProtocolImplementationParams } from "../protocol-interface.ts";
import { protocolUsage, defineProtocol } from "../protocol-interface.ts";
import { parseToolCall } from "../parse-tool-call.ts";
import type {
  Agent,
  AnthropicAssistantData,
  AssistantMessage,
  MalformedToolRequest,
  OwnToolCall,
} from "../../llm-ir.ts";
import { errorToString, err } from "../../result.ts";
import type { AnthropicCompileConfig } from "./compiler-anthropic.ts";
import { anthropicCompiler, anthropicCurl } from "./compiler-anthropic.ts";

export type AnthropicBackend = AnthropicCompileConfig & {
  client: Anthropic;
};

export const anthropicProtocol: Protocol<AnthropicBackend> = defineProtocol(
  async <A extends Agent<any, any, any, any>>(
    params: ProtocolImplementationParams<A, AnthropicBackend>,
  ) => {
    const { model, backend, irs, abortSignal, transport, systemPrompt, autofixJson } = params;

    const request = await anthropicCompiler({
      model,
      irs,
      systemPrompt,
      tools: params.tools,
      config: backend,
    });
    const curl = anthropicCurl(request, backend.client.baseURL);

    const toolDefs = params.tools || {};

    try {
      const { data: stream, response } = await backend.client.messages
        .create(request, { signal: abortSignal })
        .withResponse();

      let content = "";
      let reasoningContent: string | undefined = undefined;
      const usage = {
        input: 0,
        cachedInput: 0,
        output: 0,
      };
      const thinkingBlocks: Array<
        | {
            type: "thinking";
            thinking?: string;
            signature?: string;
            index: number;
          }
        | {
            type: "redacted_thinking";
            data: string;
          }
      > = [];
      const inProgressTools = new Map<
        number,
        {
          id: string;
          index: number;
          name: string;
          partialJson: string;
        }
      >();
      try {
        for await (const chunk of stream) {
          if (abortSignal.aborted) break;

          switch (chunk.type) {
            case "content_block_delta":
              switch (chunk.delta.type) {
                case "text_delta":
                  content += chunk.delta.text;
                  await params.onTokens(chunk.delta.text, "content");
                  break;
                case "thinking_delta":
                  if (reasoningContent == null) reasoningContent = "";
                  reasoningContent += chunk.delta.thinking;
                  await params.onTokens(chunk.delta.thinking, "reasoning");
                  if (thinkingBlocks.length === 0) {
                    thinkingBlocks.push({
                      type: "thinking",
                      thinking: chunk.delta.thinking,
                      index: chunk.index,
                    });
                  } else {
                    const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
                    if (lastBlock.type === "thinking" && lastBlock.index === chunk.index) {
                      lastBlock.thinking += chunk.delta.thinking;
                    } else {
                      thinkingBlocks.push({
                        type: "thinking",
                        thinking: chunk.delta.thinking,
                        index: chunk.index,
                      });
                    }
                  }
                  break;
                case "signature_delta":
                  if (thinkingBlocks.length === 0) {
                    thinkingBlocks.push({
                      type: "thinking",
                      signature: chunk.delta.signature,
                      index: chunk.index,
                    });
                  } else {
                    const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
                    if (lastBlock.type === "thinking" && lastBlock.index === chunk.index) {
                      lastBlock.signature = chunk.delta.signature;
                    } else {
                      thinkingBlocks.push({
                        type: "thinking",
                        signature: chunk.delta.signature,
                        index: chunk.index,
                      });
                    }
                  }
                  break;
                case "input_json_delta":
                  {
                    const tool = inProgressTools.get(chunk.index);
                    if (tool != null) {
                      await params.onTokens(chunk.delta.partial_json, "tool");
                      tool.partialJson += chunk.delta.partial_json;
                    }
                  }
                  break;
              }
              break;
            case "content_block_start":
              switch (chunk.content_block.type) {
                case "tool_use":
                  await params.onTokens(chunk.content_block.name, "tool");
                  inProgressTools.set(chunk.index, {
                    id: chunk.content_block.id,
                    index: chunk.index,
                    name: chunk.content_block.name,
                    partialJson: "",
                  });
                  break;
                case "redacted_thinking":
                  thinkingBlocks.push({
                    type: "redacted_thinking",
                    data: chunk.content_block.data,
                  });
                  break;
              }
              break;

            case "message_delta":
              usage.output = chunk.usage.output_tokens;
              if (chunk.usage.input_tokens && chunk.usage.input_tokens > 0) {
                usage.input = chunk.usage.input_tokens;
              }
              usage.cachedInput = chunk.usage.cache_read_input_tokens ?? usage.cachedInput;
              break;
            case "message_start":
              usage.input = chunk.message.usage.input_tokens;
              usage.cachedInput = chunk.message.usage.cache_read_input_tokens ?? 0;
              break;
          }
        }
      } catch (e) {
        if (!abortSignal.aborted) {
          return err({
            type: "stream-error",
            requestError: errorToString(e),
            curl,
            usage: protocolUsage(usage.input, usage.output, usage.cachedInput),
            headers: response.headers,
          });
        }
      }

      const protocolTokens = protocolUsage(usage.input, usage.output, usage.cachedInput);

      const anthropic: { anthropic?: AnthropicAssistantData } = {};
      if (thinkingBlocks.length > 0) {
        anthropic.anthropic = {
          thinkingBlocks: thinkingBlocks.map(b => {
            if (b.type === "redacted_thinking") return b;
            return ThinkingBlockSchema.slice({
              type: "thinking",
              signature: b.signature || "",
              thinking: b.thinking || "",
            });
          }),
        };
      }

      const assistantMessage: AssistantMessage<A["tools"]> = {
        role: "assistant",
        content,
        reasoningContent,
        ...anthropic,
        usage: protocolTokens,
      };

      return params.finish({
        curl,
        headers: response.headers,
        usage: protocolTokens,
        abortedOutput: assistantMessage,
        parsedOutput: async () => {
          if (inProgressTools.size === 0) return assistantMessage;

          // Sort tool calls by their content block index to preserve ordering
          const sortedTools = Array.from(inProgressTools.entries())
            .sort(([a], [b]) => a - b)
            .map(([_, v]) => v);

          const toolCalls: Array<ToolCallRequest<A> | MalformedToolRequest> = [];

          for (const inProgressTool of sortedTools) {
            const chatToolCall = {
              toolCallId: inProgressTool.id,
              toolName: inProgressTool.name,
              args: inProgressTool.partialJson,
            };
            const parseResult = await parseToolCall<A["tools"]>({
              toolCall: chatToolCall,
              toolDefs,
              autofixJson,
              abortSignal,
              transport,
            });

            if (parseResult.status === "error") {
              toolCalls.push({
                type: "malformed-tool-request",
                error: parseResult.message,
                toolCallId: inProgressTool.id,
                call: {
                  original: {
                    name: inProgressTool.name,
                    arguments: inProgressTool.partialJson,
                  },
                },
              });
              continue;
            }

            toolCalls.push(parseResult.tool);
          }

          if (toolCalls.length > 0) assistantMessage.toolCalls = toolCalls;
          return assistantMessage;
        },
      });
    } catch (e) {
      return err({
        type: "request-error",
        requestError: errorToString(e),
        curl,
      });
    }
  },
);

type ToolCallRequest<A extends Agent<any, any, any, any>> = OwnToolCall<A>;

const ThinkingBlockSchema = t.subtype({
  type: t.value("thinking"),
  thinking: t.str,
  signature: t.str,
});
