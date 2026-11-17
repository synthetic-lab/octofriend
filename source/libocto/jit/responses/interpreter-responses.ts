import { toJSONSchema } from "structural";
import type {
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";
import type { Interpreter, InterpreterImplementationParams } from "../jit-interface.ts";
import { interpreterUsage, defineInterpreter } from "../jit-interface.ts";
import { parseToolCall } from "../parse-tool-call.ts";
import type {
  Agent,
  AssistantMessage,
  MalformedToolRequest,
  OwnToolCall,
  OwnToolRegistry,
} from "../../llm-ir.ts";
import { errorToString, err } from "../../result.ts";
import type { OpenAIBackend } from "../openai-shared.ts";
import { openAIRequestError } from "../openai-shared.ts";
import type { JsonObject, JsonValue } from "./compiler-responses.ts";
import { responsesCompiler, responsesCurl } from "./compiler-responses.ts";

export const runResponsesAgent: Interpreter<OpenAIBackend> = defineInterpreter(
  async <A extends Agent<any, any, any, any>>(
    params: InterpreterImplementationParams<A, OpenAIBackend>,
  ) => {
    const { model, backend, irs, abortSignal, transport, systemPrompt, autofixJson } = params;

    const request = await responsesCompiler({
      model,
      irs,
      systemPrompt,
      tools: params.tools,
      config: backend,
    });
    const curl = responsesCurl(request, backend.client.baseURL);

    const toolDefs = params.tools || {};

    try {
      const { data: stream, response } = await backend.client.responses
        .create(request, { signal: abortSignal })
        .withResponse();

      let content = "";
      let reasoningId: string | undefined = undefined;
      let reasoningContent: string | undefined = undefined;
      let encryptedReasoningContent: string | undefined = undefined;
      const usage = {
        input: 0,
        cachedInput: 0,
        output: 0,
        reasoning: 0,
      };
      const responseToolCalls = new Map<string, ResponseFunctionToolCall>();

      async function captureOutputItem(item: ResponseOutputItem): Promise<void> {
        if (item.type === "function_call") {
          await params.onTokens("", "tool");
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
              await params.onTokens(event.delta, "content");
              break;

            case "response.reasoning_text.delta":
            case "response.reasoning_summary_text.delta":
              if (reasoningContent == null) reasoningContent = "";
              reasoningContent += event.delta;
              await params.onTokens(event.delta, "reasoning");
              break;

            case "response.function_call_arguments.delta":
              await params.onTokens(event.delta, "tool");
              break;

            case "response.output_item.done":
              await captureOutputItem(event.item);
              break;

            case "response.completed":
              for (const item of event.response.output) await captureOutputItem(item);
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
                usage: interpreterUsage(usage.input, usage.output, usage.cachedInput),
                headers: response.headers,
              });

            case "error":
              return err({
                type: "stream-error",
                requestError: event.message,
                curl,
                usage: interpreterUsage(usage.input, usage.output, usage.cachedInput),
                headers: response.headers,
              });
          }
        }
      } catch (e) {
        if (!abortSignal.aborted) {
          return err({
            type: "stream-error",
            requestError: errorToString(e),
            curl,
            usage: interpreterUsage(usage.input, usage.output, usage.cachedInput),
            headers: response.headers,
          });
        }
      }

      const interpreterTokens = interpreterUsage(usage.input, usage.output, usage.cachedInput);

      let openaiSpecific = {};
      if (reasoningId || encryptedReasoningContent) {
        openaiSpecific = { openai: { reasoningId, encryptedReasoningContent } };
      }
      const assistantHistoryItem: AssistantMessage<A["tools"]> = {
        role: "assistant",
        content,
        reasoningContent,
        ...openaiSpecific,
        usage: interpreterTokens,
      };

      return params.finish({
        curl,
        headers: response.headers,
        usage: interpreterTokens,
        abortedOutput: assistantHistoryItem,
        parsedOutput: async () => {
          if (responseToolCalls.size === 0) return assistantHistoryItem;

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
          return assistantHistoryItem;
        },
      });
    } catch (e) {
      return err(openAIRequestError(curl, e));
    }
  },
);

type ToolCallRequest<A extends Agent<any, any, any, any>> = OwnToolCall<A>;
type LoadedTool<A extends Agent<any, any, any, any>> = OwnToolRegistry<A>[keyof OwnToolRegistry<A>];

function reasoningTextFromItem(item: ResponseReasoningItem): string {
  const content = item.content?.map(part => part.text) || [];
  const summary = item.summary.map(part => part.text);
  return [...content, ...summary].join("\n");
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

function objectRecord(value: JsonValue | undefined): JsonObject | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function isString(value: JsonValue): value is string {
  return typeof value === "string";
}
