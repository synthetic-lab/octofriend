import { toJSONSchema } from "structural";
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { CompileInputs, CompilerIR } from "../protocol-interface.ts";
import type { Agent, Content as IRContent, OwnToolRegistry } from "../../llm-ir.ts";
import * as irPrompts from "../ir-prompts.ts";
import { tagged } from "../ir-prompts.ts";
import type { OpenAICompileConfig } from "../openai-shared.ts";
import type { MultimodalConfig } from "../../modalities.ts";

export async function toLlmMessages<A extends Agent<any, any, any, any>>(
  messages: Array<CompilerIR<A>>,
  systemPrompt?: () => Promise<string>,
  modalities?: MultimodalConfig | null,
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

/*
 * Compiles libocto IR into a complete OpenAI chat completions request body: messages, tool
 * schemas, and the request options that callers would otherwise have to know to set (streaming
 * usage reporting in particular, without which no token counts come back at all).
 */
export async function chatCompletionsCompiler<A extends Agent<any, any, any, any>>(
  params: CompileInputs<A> & { config?: OpenAICompileConfig },
): Promise<ChatCompletionCreateParamsStreaming> {
  const messages = await toLlmMessages(params.irs, params.systemPrompt, params.model.modalities);

  const toolsMap = toChatCompletionsTools(params.tools);
  const toolsParam = toolsMap.length === 0 ? {} : { tools: toolsMap };

  const reasoning: {
    reasoning_effort?: "low" | "medium" | "high";
  } = {};
  if (params.config?.reasoningEffort)
    reasoning.reasoning_effort = params.config.reasoningEffort as "low" | "medium" | "high";

  return {
    ...reasoning,
    model: params.model.model,
    messages,
    ...toolsParam,
    stream: true,
    stream_options: {
      include_usage: true,
    },
  };
}

export function chatCompletionsCurl(
  request: ChatCompletionCreateParamsStreaming,
  baseURL: string,
): string {
  return `curl -X POST '${baseURL}/chat/completions' \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer [REDACTED_API_KEY]" \\
  -d @- <<'JSON'
${JSON.stringify(request)}
JSON`;
}

type LoadedTool<A extends Agent<any, any, any, any>> = OwnToolRegistry<A>[keyof OwnToolRegistry<A>];

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

const TOOL_ERROR_TAG = "tool-runtime-error";

function llmFromIr<A extends Agent<any, any, any, any>>(
  ir: CompilerIR<A>,
  modalities?: MultimodalConfig | null,
): LlmMessage {
  if (ir.role === "assistant") {
    const { toolCalls } = ir;
    const reasoning: { reasoning?: string } = {};
    if (ir.reasoningContent) reasoning.reasoning = ir.reasoningContent;

    /*
     * Malformed tool requests are dropped from tool_calls entirely: their arguments may be
     * unparseable (e.g. a connection died mid-stream, leaving half a JSON string), and
     * backends that validate historical tool call arguments would reject the request. The
     * failure is re-delivered as a user message by the tool-parse-error branch below, so the
     * model still learns its call malformed and can recover.
     */
    const validToolCalls = (toolCalls ?? []).filter((t: any) => t.type === "tool-call");
    if (validToolCalls.length === 0) {
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
      tool_calls: validToolCalls.map((tc: any) => {
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

  /*
   * A tool-parse-error's malformed call is not re-emitted as an assistant tool_call (see the
   * assistant branch above), so there is nothing for a tool message's tool_call_id to resolve
   * to — and strict backends hard-reject tool messages without a matching preceding tool_call.
   * Deliver the failure as a plain user message instead; a user message is always legal, and
   * the model can see its call malformed and recover.
   */
  if (ir.role === "tool-parse-error") {
    return {
      role: "user",
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

function openaiContentParts(
  content: IRContent["content"],
  modalities?: MultimodalConfig | null,
): UserContent {
  const output: UserContent = [];
  for (const part of content) {
    if (part.type === "text") {
      output.push({ type: "text", text: part.content });
      continue;
    }
    if (modalities?.image?.enabled) {
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

function toChatCompletionsTools<A extends Agent<any, any, any, any>>(
  tools?: Partial<OwnToolRegistry<A>>,
) {
  const toolDefs = tools || {};
  const toolEntries = Object.entries(toolDefs) as Array<[string, LoadedTool<A>]>;
  return toolEntries.map(([name, tool]) => {
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
}

function imagePlaceholderContent(): string {
  return irPrompts.imageAttachmentPlaceholderText();
}
