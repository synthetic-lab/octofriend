import { t, toJSONSchema } from "structural";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  Compiler,
  CompilerImplementationResult,
  CompilerIR,
  CompilerModalities,
  CompilerParamsImplementation,
} from "./compiler-interface.ts";
import {
  compilerParamsHaveTools,
  compilerUsage,
  defineCompiler,
  unexpectedToolCallError,
} from "./compiler-interface.ts";
import { parseToolCall } from "./parse-tool-call.ts";
import type {
  Agent,
  AssistantMessage as AssistantIR,
  Content as IRContent,
  MalformedToolRequest,
} from "../llm-ir.ts";
import type { LoadedTools, ToolCall } from "../tool-def.ts";
import { errorToString, ok, err } from "../result.ts";
import * as irPrompts from "./ir-prompts.ts";
import { tagged } from "./ir-prompts.ts";
import type { OpenAICompilerModel } from "./openai-shared.ts";
import { openAIRequestError } from "./openai-shared.ts";

type ToolCallRequest<A extends Agent<any, any, any>> = ToolCall<A["tools"]>;
type LoadedTool<A extends Agent<any, any, any>> = LoadedTools<A["tools"]>[keyof LoadedTools<
  A["tools"]
>];

type UserContent = Array<
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    }
>;
type UserMessage = {
  role: "user";
  content: UserContent;
};

type AssistantMessage = {
  role: "assistant";
  content: string;
  tool_calls?: Array<{
    type: "function";
    function: {
      arguments: string;
      name: string;
    };
    id: string;
  }>;
};

type ToolMessage = {
  role: "tool";
  content: UserContent;
  tool_call_id: string;
};

type SystemPrompt = {
  role: "system";
  content: string;
};

type LlmMessage = SystemPrompt | UserMessage | AssistantMessage | ToolMessage;

type ChatCompletionCompatibleMessage =
  | Exclude<ChatCompletionMessageParam, { role: "tool" }>
  | (Omit<Extract<ChatCompletionMessageParam, { role: "tool" }>, "content"> & {
      content: UserContent;
    });

const ResponseToolCallSchema = t.subtype({
  id: t.str,
  function: t.subtype({
    name: t.str,
    arguments: t.str,
  }),
});

type ResponseToolCall = t.GetType<typeof ResponseToolCallSchema>;

const TOOL_ERROR_TAG = "tool-runtime-error";

function imagePlaceholderContent(): string {
  return irPrompts.imageAttachmentPlaceholderText();
}

function openaiContentParts(
  content: IRContent["content"],
  modalities?: CompilerModalities,
): UserContent {
  const output: UserContent = [];
  for (const part of content) {
    if (part.type === "text") {
      output.push({ type: "text", text: part.content });
      continue;
    }
    if (modalities?.includes("vision")) {
      output.push({
        type: "image_url",
        image_url: { url: part.image.dataUrl },
      });
    } else {
      output.push({ type: "text", text: imagePlaceholderContent() });
    }
  }
  return output;
}

function generateCurlFrom(params: {
  baseURL: string;
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: any[];
}): string {
  const { baseURL, model, messages, tools } = params;

  const requestBody = {
    model,
    messages,
    tools,
    stream: true,
    stream_options: {
      include_usage: true,
    },
  };

  return `curl -X POST '${baseURL}/chat/completions' \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer [REDACTED_API_KEY]" \\
  -d @- <<'JSON'
${JSON.stringify(requestBody)}
JSON`;
}

async function toLlmMessages<A extends Agent<any, any, any>>(
  messages: Array<CompilerIR<A>>,
  systemPrompt?: () => Promise<string>,
  modalities?: CompilerModalities,
): Promise<Array<ChatCompletionMessageParam>> {
  const output: LlmMessage[] = [];

  for (const ir of messages) {
    output.push(llmFromIr(ir, modalities));
  }

  if (systemPrompt) {
    const prompt = await systemPrompt();
    output.unshift({
      role: "system",
      content: prompt,
    });
  }

  return output as ChatCompletionCompatibleMessage[] as ChatCompletionMessageParam[];
}

function llmFromIr<A extends Agent<any, any, any>>(
  ir: CompilerIR<A>,
  modalities?: CompilerModalities,
): LlmMessage {
  if (ir.role === "assistant") {
    const { toolCalls } = ir;
    const reasoning: { reasoning_content?: string } = {};
    if (ir.reasoningContent) reasoning.reasoning_content = ir.reasoningContent;

    if (toolCalls == null || toolCalls.length === 0) {
      return {
        ...reasoning,
        role: "assistant",
        content: ir.content || " ", // Some APIs don't like zero-length content strings
      };
    }
    return {
      ...reasoning,
      role: "assistant",
      content: ir.content,
      tool_calls: toolCalls
        .filter((t: any) => t.type === "tool-call")
        .map((tc: any) => {
          return {
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.original ? JSON.stringify(tc.original) : "{}",
            },
            id: tc.toolCallId,
          };
        }),
    };
  }
  if (ir.role === "user") {
    return { role: "user", content: openaiContentParts(ir.content, modalities) };
  }

  if (ir.role === "tool-output") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: openaiContentParts(ir.content, modalities),
    };
  }

  if (ir.role === "tool-skip-output") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: [{ type: "text", text: tagged(TOOL_ERROR_TAG, {}, irPrompts.toolSkip(ir.reason)) }],
    };
  }

  if (ir.role === "tool-parse-error") {
    return {
      role: "tool",
      tool_call_id: ir.malformedRequest.toolCallId,
      content: [
        {
          type: "text",
          text: "Malformed tool call: " + tagged(TOOL_ERROR_TAG, {}, ir.malformedRequest.error),
        },
      ],
    };
  }

  if (ir.role === "tool-validation-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: [
        {
          type: "text",
          text: "Error from tool call validation: " + tagged(TOOL_ERROR_TAG, {}, ir.error),
        },
      ],
    };
  }

  if (ir.role === "tool-runtime-error") {
    return {
      role: "tool",
      tool_call_id: ir.toolCall.toolCallId,
      content: [{ type: "text", text: "Error: " + tagged(TOOL_ERROR_TAG, {}, ir.error) }],
    };
  }

  if (ir.role === "lowered-checkpoint") {
    return {
      role: "user",
      content: openaiContentParts(ir.content, modalities),
    };
  }

  const _: never = ir;

  throw new Error(`Unsupported IR role: ${(ir as any).role}`);
}

async function handleKnownErrors<A extends Agent<any, any, any>>(
  curl: string,
  cb: () => Promise<CompilerImplementationResult<A>>,
): Promise<CompilerImplementationResult<A>> {
  try {
    return await cb();
  } catch (e) {
    return err(openAIRequestError(curl, e));
  }
}

export const runAgent: Compiler<OpenAICompilerModel> = defineCompiler(
  async <A extends Agent<any, any, any>>(
    params: CompilerParamsImplementation<A, OpenAICompilerModel>,
  ): Promise<CompilerImplementationResult<A>> => {
    const { model, irs, abortSignal, transport, systemPrompt, autofixJson } = params;
    const messages = await toLlmMessages(irs, systemPrompt, model.modalities);

    const toolDefs = params.tools || {};
    const toolEntries = Object.entries(toolDefs) as Array<[string, LoadedTool<A>]>;
    const toolsMap = toolEntries.map(([name, tool]) => {
      const argJsonSchema = toJSONSchema("ignore", tool.ArgumentsSchema);
      // Delete JSON schema fields unused by OpenAI compatible APIs; some APIs will error if present
      // @ts-ignore
      delete argJsonSchema.$schema;
      delete argJsonSchema.description;
      // @ts-ignore
      delete argJsonSchema.title;

      return {
        type: "function" as const,
        function: {
          name: name,
          description: tool.description,
          parameters: argJsonSchema,
          strict: true,
        },
      };
    });
    const toolsParam =
      toolEntries.length === 0
        ? {}
        : {
            tools: toolsMap,
          };

    const curl = generateCurlFrom({
      baseURL: model.client.baseURL,
      model: model.model,
      messages,
      ...toolsParam,
    });
    return await handleKnownErrors(curl, async () => {
      let reasoning: {
        reasoning_effort?: "low" | "medium" | "high";
      } = {};
      if (model.reasoningEffort) reasoning.reasoning_effort = model.reasoningEffort;

      const { data: res, response } = await model.client.chat.completions
        .create(
          {
            ...reasoning,
            model: model.model,
            messages,
            ...toolsParam,
            stream: true,
            stream_options: {
              include_usage: true,
            },
          },
          {
            signal: abortSignal,
          },
        )
        .withResponse();

      let content = "";
      let reasoningContent: undefined | string = undefined;
      let usage = {
        input: 0,
        cachedInput: 0,
        output: 0,
      };

      let toolCallMap = new Map<number, Partial<ResponseToolCall>>();
      let unexpectedToolCall = false;

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
            params.onTokens(tokens, "content");
          } else if (delta && "reasoning_content" in delta && delta.reasoning_content) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += delta.reasoning_content;
            params.onTokens(delta.reasoning_content, "reasoning");
          } else if (delta && "reasoning" in delta && delta.reasoning) {
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += delta.reasoning;
            params.onTokens(delta.reasoning, "reasoning");
          } else if (
            delta &&
            "tool_calls" in delta &&
            delta.tool_calls &&
            delta.tool_calls.length > 0
          ) {
            for (const deltaCall of delta.tool_calls) {
              if (!compilerParamsHaveTools(params)) {
                unexpectedToolCall = true;
                continue;
              }
              const index = deltaCall.index ?? 0;
              params.onTokens(
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

      // If aborted, don't try to parse tool calls - just return the assistant response
      if (abortSignal.aborted) {
        return ok({ output: assistantIr, curl, headers: response.headers, usage: compilerTokens });
      }

      if (unexpectedToolCall) {
        return err(unexpectedToolCallError(curl, compilerTokens));
      }

      // If no tool calls, we're done
      if (toolCallMap.size === 0) {
        return ok({ output: assistantIr, curl, headers: response.headers, usage: compilerTokens });
      }

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

      return ok({ output: assistantIr, curl, headers: response.headers, usage: compilerTokens });
    });
  },
);
