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
  AssistantMessage,
  Content as IRContent,
  MalformedToolRequest,
} from "../llm-ir.ts";
import type { LoadedTools, ToolCall } from "../tool-def.ts";
import { errorToString, ok, err } from "../result.ts";
import * as irPrompts from "./ir-prompts.ts";
import type { OpenAICompilerModel } from "./openai-shared.ts";
import { openAIRequestError } from "./openai-shared.ts";

type ToolCallRequest<A extends Agent<any, any, any>> = ToolCall<A["tools"]>;
type LoadedTool<A extends Agent<any, any, any>> = LoadedTools<A["tools"]>[keyof LoadedTools<
  A["tools"]
>];
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type JsonObject = { [key: string]: JsonValue };

// OpenAI Responses strict tool schemas use a provider-specific subset of JSON Schema:
// object schemas must be closed, every property must be required, and enum/const schemas
// need explicit type hints. This lowering keeps libocto's internal schemas normal while
// producing the stricter shape OpenAI accepts at this API boundary.
export function openAIStrictFunctionParameters(schema: JsonObject): JsonObject {
  const normalized = structuredClone(schema);

  delete normalized["$schema"];
  delete normalized["description"];
  delete normalized["title"];
  lowerToOpenAIStrictSchema(normalized);

  return normalized;
}

// Because OpenAI strict mode models optional fields as required nullable fields, a missing
// optional argument can come back as `null`. Before structural validates the arguments,
// convert only those originally-optional null fields back into absent properties.
export function normalizeOpenAIStrictFunctionArguments(
  schema: JsonObject,
  args: JsonValue,
): JsonValue {
  const optionalPaths: Array<Array<string>> = [];
  collectOptionalPropertyPaths(schema, [], optionalPaths);
  return deleteNullOptionals(args, optionalPaths);
}

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

  if (ir.role === "lowered-checkpoint") {
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

export const runResponsesAgent: Compiler<OpenAICompilerModel> = defineCompiler(
  async <A extends Agent<any, any, any>>(
    params: CompilerParamsImplementation<A, OpenAICompilerModel>,
  ): Promise<CompilerImplementationResult<A>> => {
    const { model, irs, abortSignal, transport, systemPrompt, autofixJson } = params;
    const input = await toResponseInput(irs, model.modalities);
    const instructions = systemPrompt ? await systemPrompt() : undefined;

    const toolDefs = params.tools || {};
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
      const { data: stream, response } = await model.client.responses
        .create(request, { signal: abortSignal })
        .withResponse();

      let content = "";
      let reasoningId: string | undefined = undefined;
      let reasoningContent: string | undefined = undefined;
      let encryptedReasoningContent: string | undefined = undefined;
      let usage = {
        input: 0,
        cachedInput: 0,
        output: 0,
        reasoning: 0,
      };
      const responseToolCalls = new Map<string, ResponseFunctionToolCall>();
      let unexpectedToolCall = false;

      function captureOutputItem(item: ResponseOutputItem): void {
        if (item.type === "function_call") {
          if (!compilerParamsHaveTools(params)) {
            unexpectedToolCall = true;
            return;
          }
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
              params.onTokens(event.delta, "content");
              break;

            case "response.reasoning_text.delta":
            case "response.reasoning_summary_text.delta":
              if (reasoningContent == null) reasoningContent = "";
              reasoningContent += event.delta;
              params.onTokens(event.delta, "reasoning");
              break;

            case "response.function_call_arguments.delta":
              if (!compilerParamsHaveTools(params)) {
                unexpectedToolCall = true;
              } else {
                params.onTokens(event.delta, "tool");
              }
              break;

            case "response.output_item.done":
              captureOutputItem(event.item);
              break;

            case "response.completed":
              for (const item of event.response.output) captureOutputItem(item);
              if (event.response.usage) {
                usage.input = event.response.usage.input_tokens;
                usage.cachedInput = event.response.usage.input_tokens_details.cached_tokens;
                usage.output = event.response.usage.output_tokens;
                usage.reasoning = event.response.usage.output_tokens_details.reasoning_tokens;
              }
              break;

            case "response.failed":
              return err({
                type: "stream-error",
                requestError: event.response.error?.message || "OpenAI Responses request failed",
                curl,
                usage: compilerUsage(usage.input, usage.output, usage.cachedInput),
              });

            case "error":
              return err({
                type: "stream-error",
                requestError: event.message,
                curl,
                usage: compilerUsage(usage.input, usage.output, usage.cachedInput),
              });
          }
        }
      } catch (e) {
        if (!abortSignal.aborted) {
          return err({
            type: "stream-error",
            requestError: errorToString(e),
            curl,
            usage: compilerUsage(usage.input, usage.output, usage.cachedInput),
          });
        }
      }

      const compilerTokens = compilerUsage(usage.input, usage.output, usage.cachedInput);

      let openaiSpecific = {};
      if (reasoningId || encryptedReasoningContent) {
        openaiSpecific = { openai: { reasoningId, encryptedReasoningContent } };
      }
      const assistantHistoryItem: AssistantMessage<A["tools"]> = {
        role: "assistant",
        content,
        reasoningContent,
        ...openaiSpecific,
        usage: compilerTokens,
      };

      if (abortSignal.aborted) {
        return ok({
          output: assistantHistoryItem,
          curl,
          headers: response.headers,
          usage: compilerTokens,
        });
      }

      if (unexpectedToolCall) {
        return err(unexpectedToolCallError(curl, compilerTokens));
      }

      if (responseToolCalls.size === 0) {
        return ok({
          output: assistantHistoryItem,
          curl,
          headers: response.headers,
          usage: compilerTokens,
        });
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

      return ok({
        output: assistantHistoryItem,
        curl,
        headers: response.headers,
        usage: compilerTokens,
      });
    } catch (e) {
      return err(openAIRequestError(curl, e));
    }
  },
);

function normalizeResponseToolArguments(schema: JsonObject, rawArguments: string): string {
  try {
    return JSON.stringify(
      normalizeOpenAIStrictFunctionArguments(schema, JSON.parse(rawArguments) as JsonValue),
    );
  } catch {
    return rawArguments;
  }
}

function lowerToOpenAIStrictSchema(schema: JsonValue): JsonValue {
  if (Array.isArray(schema)) {
    return schema.map(item => lowerToOpenAIStrictSchema(item));
  }

  if (schema == null || typeof schema !== "object") return schema;

  const node = schema;
  addOpenAIStrictTypeHints(node);
  const properties = objectRecord(node["properties"]);

  if (properties) {
    const required = new Set(
      Array.isArray(node["required"]) ? node["required"].filter(isString) : [],
    );
    const propertyNames = Object.keys(properties);

    for (const propertyName of propertyNames) {
      const loweredProperty = lowerToOpenAIStrictSchema(properties[propertyName]);
      properties[propertyName] = required.has(propertyName)
        ? loweredProperty
        : nullableSchema(loweredProperty);
    }

    node["required"] = propertyNames;
  }

  if (properties && node["additionalProperties"] === undefined) {
    node["additionalProperties"] = false;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "required") continue;
    node[key] = lowerToOpenAIStrictSchema(value);
  }

  return node;
}

function collectOptionalPropertyPaths(
  schema: JsonValue,
  path: Array<string>,
  optionalPaths: Array<Array<string>>,
): void {
  if (Array.isArray(schema)) {
    for (const item of schema) collectOptionalPropertyPaths(item, path, optionalPaths);
    return;
  }

  if (schema == null || typeof schema !== "object") return;

  const properties = objectRecord(schema["properties"]);
  if (properties) {
    const required = new Set(
      Array.isArray(schema["required"]) ? schema["required"].filter(isString) : [],
    );

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      const propertyPath = [...path, propertyName];
      if (!required.has(propertyName)) optionalPaths.push(propertyPath);
      collectOptionalPropertyPaths(propertySchema, propertyPath, optionalPaths);
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" || key === "required") continue;
    collectOptionalPropertyPaths(value, path, optionalPaths);
  }
}

function deleteNullOptionals(args: JsonValue, optionalPaths: Array<Array<string>>): JsonValue {
  if (args == null || typeof args !== "object" || Array.isArray(args)) return args;
  const normalized = structuredClone(args);

  for (const path of optionalPaths) deleteIfNullAtPath(normalized, path);

  return normalized;
}

function deleteIfNullAtPath(value: JsonValue, path: Array<string>): void {
  if (path.length === 0 || value == null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const node = value;
  const [key, ...rest] = path;
  if (rest.length === 0) {
    if (node[key] === null) delete node[key];
    return;
  }

  deleteIfNullAtPath(node[key], rest);
}

function addOpenAIStrictTypeHints(node: JsonObject): void {
  if (node["type"] !== undefined) return;
  const enumValues = node["enum"];
  if (Array.isArray(enumValues)) {
    const nonNullValues = enumValues.filter(value => value !== null);
    if (nonNullValues.length > 0 && nonNullValues.every(value => typeof value === "string")) {
      node["type"] = enumValues.includes(null) ? ["string", "null"] : "string";
      return;
    }
  }

  const constValue = node["const"];
  if (typeof constValue === "string") node["type"] = "string";
}

function nullableSchema(schema: JsonValue): JsonValue {
  if (schema == null || typeof schema !== "object" || Array.isArray(schema)) {
    return { anyOf: [schema, { type: "null" }] };
  }

  const node = schema;
  const type = node["type"];
  if (type === "null") return node;
  if (typeof type === "string") return { ...node, type: [type, "null"] };
  if (Array.isArray(type)) {
    if (type.includes("null")) return node;
    return { ...node, type: [...type, "null"] };
  }

  const anyOf = node["anyOf"];
  if (Array.isArray(anyOf)) {
    if (anyOf.some(isNullSchema)) return node;
    return { ...node, anyOf: [...anyOf, { type: "null" }] };
  }

  return { anyOf: [node, { type: "null" }] };
}

function isNullSchema(schema: JsonValue): boolean {
  return (
    schema != null &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    schema["type"] === "null"
  );
}

function objectRecord(value: JsonValue | undefined): JsonObject | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function isString(value: JsonValue): value is string {
  return typeof value === "string";
}
