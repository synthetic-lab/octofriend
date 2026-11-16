import { t } from "structural";
import type { Compiler, CompilerError, CompilerImplementationParams } from "../jit-interface.ts";
import { compilerUsage, defineCompiler } from "../jit-interface.ts";
import { parseToolCall } from "../parse-tool-call.ts";
import type {
  Agent,
  AssistantMessage as AssistantIR,
  MalformedToolRequest,
  OwnToolCall,
} from "../../llm-ir.ts";
import { errorToString, err, type Result } from "../../result.ts";
import type { OpenAIBackend } from "../openai-shared.ts";
import { openAIRequestError } from "../openai-shared.ts";
import { chatCompletionsCompiler, chatCompletionsCurl } from "./compiler-chat-completions.ts";

export const runAgent: Compiler<OpenAIBackend> = defineCompiler(
  async <A extends Agent<any, any, any, any>>(
    params: CompilerImplementationParams<A, OpenAIBackend>,
  ) => {
    const { model, backend, irs, abortSignal, transport, systemPrompt, autofixJson } = params;

    const request = await chatCompletionsCompiler({
      model,
      irs,
      systemPrompt,
      tools: params.tools,
      config: backend,
    });
    const curl = chatCompletionsCurl(request, backend.client.baseURL);

    const toolDefs = params.tools || {};

    return await handleKnownErrors(curl, async () => {
      const { data: res, response } = await backend.client.chat.completions
        .create(request, {
          signal: abortSignal,
        })
        .withResponse();

      let content = "";
      let reasoningContent: undefined | string = undefined;
      const usage = {
        input: 0,
        cachedInput: 0,
        output: 0,
      };

      const toolCallMap = new Map<number, Partial<ResponseToolCall>>();

      try {
        for await (const chunk of res) {
          if (abortSignal.aborted) break;
          if (chunk.usage) {
            usage.input = chunk.usage.prompt_tokens;
            usage.cachedInput = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
            usage.output = chunk.usage.completion_tokens;
          }

          const delta = chunk.choices[0]?.delta as
            | {
                content: string;
              }
            | {
                reasoning_content: string;
              }
            | {
                tool_calls: Array<ResponseToolCall & { index?: number }>;
              }
            | {
                reasoning: string;
              }
            | null;

          if (delta && "content" in delta && delta.content) {
            const tokens = delta.content || "";
            content += tokens;
            await params.onTokens(tokens, "content");
          }
          if (delta && "reasoning_content" in delta && delta.reasoning_content) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += delta.reasoning_content;
            await params.onTokens(delta.reasoning_content, "reasoning");
          } else if (delta && "reasoning" in delta && delta.reasoning) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += delta.reasoning;
            await params.onTokens(delta.reasoning, "reasoning");
          }
          if (delta && "tool_calls" in delta && delta.tool_calls && delta.tool_calls.length > 0) {
            for (const deltaCall of delta.tool_calls) {
              const index = deltaCall.index ?? 0;
              await params.onTokens(
                (deltaCall.function.name || "") + (deltaCall.function.arguments || ""),
                "tool",
              );
              if (deltaCall.id) {
                toolCallMap.set(index, {
                  id: deltaCall.id,
                  function: {
                    name: deltaCall.function.name || "",
                    arguments: deltaCall.function.arguments || "",
                  },
                });
              } else {
                const curr = toolCallMap.get(index);
                if (curr) {
                  if (deltaCall.function.name) curr.function!.name = deltaCall.function.name;
                  if (deltaCall.function.arguments)
                    curr.function!.arguments += deltaCall.function.arguments;
                }
              }
            }
          }
        }
      } catch (e) {
        // Handle abort errors gracefully
        if (abortSignal.aborted) {
          // Fall through to return abbreviated response
        } else {
          return err({
            type: "stream-error",
            requestError: errorToString(e),
            curl,
            usage: compilerUsage(usage.input, usage.output, usage.cachedInput),
            headers: response.headers,
          });
        }
      }

      const compilerTokens = compilerUsage(usage.input, usage.output, usage.cachedInput);

      const assistantIr: AssistantIR<A["tools"]> = {
        role: "assistant" as const,
        content,
        reasoningContent,
        usage: compilerTokens,
      };

      return params.finish({
        curl,
        headers: response.headers,
        usage: compilerTokens,
        abortedOutput: assistantIr,
        parsedOutput: async () => {
          if (toolCallMap.size === 0) return assistantIr;

          // Sort tool calls by their streaming index to preserve ordering
          const currTools = Array.from(toolCallMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([_, v]) => v);

          const toolCalls: Array<MalformedToolRequest | ToolCallRequest<A>> = [];

          for (const currTool of currTools) {
            const validatedTool = ResponseToolCallSchema.sliceResult(currTool);
            if (validatedTool instanceof t.Err) {
              const toolCallId = currTool["id"];
              if (toolCallId == null) throw new Error("Impossible tool call: no id given");
              toolCalls.push({
                type: "malformed-tool-request",
                error: validatedTool.message,
                call: {
                  original: {
                    name: currTool.function?.name || "unknown",
                    arguments: currTool.function?.arguments || "",
                  },
                },
                toolCallId,
              });
              continue;
            }

            const parseResult = await parseToolCall<A["tools"]>({
              toolCall: {
                toolCallId: validatedTool.id,
                toolName: validatedTool.function.name,
                args: validatedTool.function.arguments,
              },
              toolDefs,
              autofixJson,
              abortSignal,
              transport,
            });

            if (parseResult.status === "error") {
              toolCalls.push({
                type: "malformed-tool-request",
                error: parseResult.message,
                call: {
                  original: {
                    name: validatedTool.function.name,
                    arguments: validatedTool.function.arguments,
                  },
                },
                toolCallId: validatedTool.id,
              });
              continue;
            }

            toolCalls.push(parseResult.tool);
          }

          if (toolCalls.length > 0) assistantIr.toolCalls = toolCalls;
          return assistantIr;
        },
      });
    });
  },
);

type ToolCallRequest<A extends Agent<any, any, any, any>> = OwnToolCall<A>;

const ResponseToolCallSchema = t.subtype({
  id: t.str,
  function: t.subtype({
    name: t.str,
    arguments: t.str,
  }),
});

type ResponseToolCall = t.GetType<typeof ResponseToolCallSchema>;

async function handleKnownErrors<T>(
  curl: string,
  cb: () => Promise<T>,
): Promise<T | Result<never, CompilerError>> {
  try {
    return await cb();
  } catch (e) {
    return err(openAIRequestError(curl, e));
  }
}
