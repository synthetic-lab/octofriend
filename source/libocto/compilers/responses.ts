import { t, toJSONSchema } from "structural";
import type {
  FunctionTool,
  ResponseCreateParamsStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";
import type {
  CompilerIR,
  CompilerModalities,
  CompilerParams,
  CompilerResult,
} from "./compiler-interface.ts";
import { parseToolCall } from "./parse-tool-call.ts";
import type {
  Agent,
  AssistantMessage,
  Content as IRContent,
  MalformedToolRequest,
} from "../llm-ir.ts";
import type { LoadedTools, ToolCall } from "../tool-def.ts";
import { trackTokens } from "../../token-tracker.ts";
import { sumAssistantTokens } from "../../ir/count-ir-tokens.ts";
import { errorToString, ok, err } from "../../result.ts";
import * as irPrompts from "../../prompts/ir-prompts.ts";
import type { OpenAICompilerModel } from "./openai.ts";
import {
  normalizeOpenAIStrictFunctionArguments,
  openAIStrictFunctionParameters,
} from "./openai.ts";
import type { JsonObject, JsonValue } from "./openai.ts";

type ToolCallRequest<A extends Agent<any, any, any>> = ToolCall<A["tools"]>;
type LoadedTool<A extends Agent<any, any, any>> = LoadedTools<A["tools"]>[keyof LoadedTools<
  A["tools"]
>];

function imagePlaceholderContent(): string {
  return irPrompts.imageAttachmentPlaceholderText();
}

function responseContentParts(
  content: IRContent["content"],
  modalities?: CompilerModalities,
): ResponseInputContent[] {
  const output: ResponseInputContent[] = [];
  for (const part of content) {
    if (part.type === "text") {
      output.push({ type: "input_text", text: part.content });
      continue;
    }
    if (modalities?.includes("vision")) {
      output.push({
        type: "input_image",
        detail: "auto",
        image_url: part.image.dataUrl,
      });
    } else {
      output.push({ type: "input_text", text: imagePlaceholderContent() });
    }
  }
  return output;
}

function responseToolOutput(
  content: IRContent["content"],
  modalities?: CompilerModalities,
): string {
  const visibleParts = content.map(part => {
    if (part.type === "text") return { type: "text" as const, text: part.content };
    if (!modalities?.includes("vision")) {
      return { type: "text" as const, text: imagePlaceholderContent() };
    }
    return {
      type: "image" as const,
      mimeType: part.image.mimeType,
      dataUrl: part.image.dataUrl,
    };
  });

  if (visibleParts.every(part => part.type === "text")) {
    return visibleParts.map(part => part.text).join("\n");
  }

  return JSON.stringify(visibleParts);
}

async function toResponseInput<A extends Agent<any, any, any>>(
  messages: Array<CompilerIR<A>>,
  modalities?: CompilerModalities,
): Promise<ResponseInput> {
  const output: ResponseInput = [];

  for (const ir of messages) {
    output.push(...responseInputFromIr(ir, modalities));
  }

  return output;
}

function responseInputFromIr<A extends Agent<any, any, any>>(
  ir: CompilerIR<A>,
  modalities?: CompilerModalities,
): ResponseInput {
  if (ir.role === "assistant") {
    const output: ResponseInput = [];
    if (ir.openai?.encryptedReasoningContent || ir.openai?.reasoningId) {
      output.push({
        type: "reasoning",
        id: ir.openai.reasoningId || "",
        summary: [],
        encrypted_content: ir.openai.encryptedReasoningContent ?? null,
      });
    }

    if (ir.content || ir.reasoningContent || ir.toolCalls == null || ir.toolCalls.length === 0) {
      output.push({
        role: "assistant",
        content: ir.content || " ",
      });
    }

    for (const toolCall of ir.toolCalls || []) {
      if (toolCall.type !== "tool-call") continue;
      output.push({
        type: "function_call",
        call_id: toolCall.toolCallId,
        name: toolCall.name,
        arguments: toolCall.original ? JSON.stringify(toolCall.original) : "{}",
      });
    }
    return output;
  }

  if (ir.role === "user") {
    return [{ role: "user", content: responseContentParts(ir.content, modalities) }];
  }

  if (ir.role === "tool-output") {
    return [
      {
        type: "function_call_output",
        call_id: ir.toolCall.toolCallId,
        output: responseToolOutput(ir.content, modalities),
      },
    ];
  }

  if (ir.role === "tool-skip-output") {
    return [
      {
        type: "function_call_output",
        call_id: ir.toolCall.toolCallId,
        output: irPrompts.toolSkip(ir.reason),
      },
    ];
  }

  if (ir.role === "tool-runtime-error") {
    return [
      {
        type: "function_call_output",
        call_id: ir.toolCall.toolCallId,
        output: `Error: ${ir.error}`,
      },
    ];
  }

  if (ir.role === "tool-parse-error") {
    return [
      {
        type: "function_call_output",
        call_id: ir.malformedRequest.toolCallId,
        output: `Error: ${ir.malformedRequest.error}`,
      },
    ];
  }

  if (ir.role === "tool-validation-error") {
    return [
      {
        type: "function_call_output",
        call_id: ir.toolCall.toolCallId,
        output: `Error: ${ir.error}`,
      },
    ];
  }

  if (ir.role === "checkpoint") {
    return [{ role: "user", content: responseContentParts(ir.content, modalities) }];
  }

  const _: never = ir;

  throw new Error(`Unsupported IR role: ${(ir as any).role}`);
}

function generateCurlFrom(params: {
  baseURL: string;
  model: string;
  input: ResponseInput;
  instructions?: string;
  tools?: FunctionTool[];
}): string {
  const { baseURL, model, input, instructions, tools } = params;

  const requestBody = {
    model,
    input,
    instructions,
    tools,
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
  };

  return `curl -X POST '${baseURL}/responses' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer [REDACTED_API_KEY]' \\
  -d @- <<'JSON'
${JSON.stringify(requestBody)}
JSON`;
}

function reasoningTextFromItem(item: ResponseReasoningItem): string {
  const content = item.content?.map(part => part.text) || [];
  const summary = item.summary.map(part => part.text);
  return [...content, ...summary].join("\n");
}

export async function runResponsesAgent<A extends Agent<any, any, any>>({
  model,
  irs,
  onTokens,
  abortSignal,
  transport,
  systemPrompt,
  autofixJson,
  tools,
}: CompilerParams<A, OpenAICompilerModel>): Promise<CompilerResult<A>> {
  const input = await toResponseInput(irs, model.modalities);
  const instructions = systemPrompt ? await systemPrompt() : undefined;

  const toolDefs = tools || {};
  const toolEntries = Object.entries(toolDefs) as Array<[string, LoadedTool<A>]>;
  const toolDefinitions = toolEntries.map(([name, toolDef]) => {
    const structuralJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema) as JsonObject;
    const argJsonSchema = openAIStrictFunctionParameters(structuralJsonSchema);

    return {
      type: "function" as const,
      name,
      description: toolDef.description,
      parameters: argJsonSchema,
      strict: true,
    };
  });
  const toolParams = toolDefinitions.length === 0 ? {} : { tools: toolDefinitions };

  const reasoningConfig = model.reasoningEffort
    ? {
        reasoning: {
          effort: model.reasoningEffort,
          summary: "auto" as const,
        },
      }
    : {};

  const request = {
    model: model.model,
    input,
    instructions,
    ...toolParams,
    ...reasoningConfig,
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
  } satisfies ResponseCreateParamsStreaming;

  const curl = generateCurlFrom({
    baseURL: model.client.baseURL,
    model: model.model,
    input,
    instructions,
    ...toolParams,
  });

  try {
    const stream = await model.client.responses.create(request, { signal: abortSignal });

    let content = "";
    let reasoningId: string | undefined = undefined;
    let reasoningContent: string | undefined = undefined;
    let encryptedReasoningContent: string | undefined = undefined;
    let usage = {
      input: 0,
      output: 0,
      reasoning: 0,
    };
    const responseToolCalls = new Map<string, ResponseFunctionToolCall>();

    function captureOutputItem(item: ResponseOutputItem): void {
      if (item.type === "function_call") {
        responseToolCalls.set(item.call_id, item);
        return;
      }

      if (item.type === "reasoning") {
        reasoningId = item.id;
        if (item.encrypted_content) encryptedReasoningContent = item.encrypted_content;
        if (reasoningContent == null) {
          const text = reasoningTextFromItem(item);
          if (text !== "") reasoningContent = text;
        }
      }
    }

    try {
      for await (const event of stream) {
        if (abortSignal.aborted) break;

        switch (event.type) {
          case "response.output_text.delta":
            content += event.delta;
            onTokens(event.delta, "content");
            break;

          case "response.reasoning_text.delta":
          case "response.reasoning_summary_text.delta":
            if (reasoningContent == null) reasoningContent = "";
            reasoningContent += event.delta;
            onTokens(event.delta, "reasoning");
            break;

          case "response.function_call_arguments.delta":
            onTokens(event.delta, "tool");
            break;

          case "response.output_item.done":
            captureOutputItem(event.item);
            break;

          case "response.completed":
            for (const item of event.response.output) captureOutputItem(item);
            if (event.response.usage) {
              usage.input = event.response.usage.input_tokens;
              usage.output = event.response.usage.output_tokens;
              usage.reasoning = event.response.usage.output_tokens_details.reasoning_tokens;
            }
            break;

          case "response.failed":
            return err({
              requestError: event.response.error?.message || "OpenAI Responses request failed",
              curl,
            });

          case "error":
            return err({
              requestError: event.message,
              curl,
            });
        }
      }
    } catch (e) {
      if (!abortSignal.aborted) {
        return err({
          requestError: errorToString(e),
          curl,
        });
      }
    }

    if (usage.input !== 0 || usage.output !== 0) {
      trackTokens(model.model, "input", usage.input);
      trackTokens(model.model, "output", usage.output);
    }

    let tokenDelta = 0;
    if (usage.input !== 0 || usage.output !== 0) {
      if (!abortSignal.aborted) {
        const previousTokens = sumAssistantTokens(irs);
        tokenDelta = usage.input + usage.output - previousTokens;
      }
    }

    let openaiSpecific = {};
    if (reasoningId || encryptedReasoningContent) {
      openaiSpecific = { openai: { reasoningId, encryptedReasoningContent } };
    }
    const assistantHistoryItem: AssistantMessage<A["tools"]> = {
      role: "assistant",
      content,
      reasoningContent,
      ...openaiSpecific,
      tokenUsage: tokenDelta,
      outputTokens: usage.output,
    };

    if (abortSignal.aborted) {
      return ok({ output: assistantHistoryItem, curl });
    }

    if (responseToolCalls.size === 0) {
      return ok({ output: assistantHistoryItem, curl });
    }

    const parsedToolCalls: Array<ToolCallRequest<A> | MalformedToolRequest> = [];

    for (const toolCall of responseToolCalls.values()) {
      const toolDef = (toolDefs as Partial<Record<string, LoadedTool<A>>>)[toolCall.name];
      const schema = toolDef
        ? (toJSONSchema("ignore", toolDef.ArgumentsSchema) as JsonObject)
        : null;
      const chatToolCall = {
        toolCallId: toolCall.call_id,
        toolName: toolCall.name,
        args: schema
          ? normalizeResponseToolArguments(schema, toolCall.arguments)
          : toolCall.arguments,
      };
      const parseResult = await parseToolCall<A["tools"]>({
        toolCall: chatToolCall,
        toolDefs,
        autofixJson,
        abortSignal,
        transport,
      });

      if (parseResult.status === "error") {
        parsedToolCalls.push({
          type: "malformed-tool-request",
          error: parseResult.message,
          call: {
            original: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          },
          toolCallId: toolCall.call_id,
        });
        continue;
      }

      parsedToolCalls.push(parseResult.tool);
    }

    if (parsedToolCalls.length > 0) assistantHistoryItem.toolCalls = parsedToolCalls;

    return ok({ output: assistantHistoryItem, curl });
  } catch (e) {
    return err({
      requestError: errorToString(e),
      curl,
    });
  }
}

function normalizeResponseToolArguments(schema: JsonObject, rawArguments: string): string {
  try {
    return JSON.stringify(
      normalizeOpenAIStrictFunctionArguments(schema, JSON.parse(rawArguments) as JsonValue),
    );
  } catch {
    return rawArguments;
  }
}
