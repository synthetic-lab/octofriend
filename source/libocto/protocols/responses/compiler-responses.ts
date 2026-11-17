import { toJSONSchema } from "structural";
import type {
  FunctionTool,
  ResponseCreateParamsStreaming,
  ResponseInput,
  ResponseInputContent,
} from "openai/resources/responses/responses";
import type { CompileInputs, CompilerIR } from "../protocol-interface.ts";
import { answeredToolCallId } from "../../llm-ir.ts";
import type { Agent, Content as IRContent, OwnToolRegistry } from "../../llm-ir.ts";
import * as irPrompts from "../ir-prompts.ts";
import type { OpenAICompileConfig } from "../openai-shared.ts";
import type { MultimodalConfig } from "../../modalities.ts";

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

export async function toResponseInput<A extends Agent<any, any, any, any>>(
  messages: Array<CompilerIR<A>>,
  modalities?: MultimodalConfig | null,
): Promise<ResponseInput> {
  /*
   * The OpenAI Responses API mandates that all function calls *must* have function call outputs
   * associated with them on requests, unlike other APIs which allow you to simply leave them out if
   * you want to (e.g. if you didn't run them). To normalize this behavior, we synthesize skip
   * outputs for any tool call with no tool-output-shaped IR answering it; this can happen e.g. if
   * Octo crashed.
   *
   * Call IDs are only unique within a single response: providers may recycle them across turns,
   * and provider-generated IDs must never be rewritten. So matching walks backwards instead of
   * keying a global set by ID: tool outputs accumulate into a pending list until the assistant IR
   * that requested them. That assistant emits its outputs in tool-call order — real outputs where
   * they exist, synthesized skips where they don't — and the list resets, so answers can never
   * leak across batches and a stale output from an earlier turn can't suppress synthesis for a
   * later, genuinely unanswered call that happens to share the ID.
   */
  const withSynthesized: Array<CompilerIR<A>> = [];
  let pendingOutputs: Array<CompilerIR<A>> = [];
  const dropOrphanOutputs = () => {
    if (pendingOutputs.length === 0) return;
    if (process.env["CANARY_OCTO"] === "1") {
      throw new Error("Canary build error: tool output IRs with no originating tool call");
    }
    pendingOutputs = [];
  };
  for (let i = messages.length - 1; i >= 0; i--) {
    const ir = messages[i];
    if (ir.role === "assistant") {
      const outputsInCallOrder: Array<CompilerIR<A>> = [];
      for (const toolCall of ir.toolCalls ?? []) {
        const matchIndex = pendingOutputs.findIndex(
          pending => answeredToolCallId(pending) === toolCall.toolCallId,
        );
        if (matchIndex >= 0) {
          outputsInCallOrder.push(...pendingOutputs.splice(matchIndex, 1));
        } else if (toolCall.type === "tool-call") {
          outputsInCallOrder.push({
            role: "tool-skip-output",
            toolCall,
            reason: "Aborted",
          });
        }
      }
      dropOrphanOutputs();
      withSynthesized.unshift(ir, ...outputsInCallOrder);
      continue;
    }
    if (answeredToolCallId(ir) != null) {
      // Walking backwards, so unshift to keep the pending list in original (forward) order.
      pendingOutputs.unshift(ir);
    } else {
      withSynthesized.unshift(ir);
    }
  }
  dropOrphanOutputs();

  const items: ResponseInput = [];
  for (const ir of withSynthesized) {
    items.push(...responseInputFromIr(ir, modalities));
  }

  return items;
}

/*
 * Compiles libocto IR into a complete OpenAI Responses request body. `store` and `include` are set
 * here because replayed reasoning items depend on them: without `reasoning.encrypted_content`
 * the model's reasoning can't be returned to it on the next turn.
 */
export async function responsesCompiler<A extends Agent<any, any, any, any>>(
  params: CompileInputs<A> & { config?: OpenAICompileConfig },
): Promise<ResponseCreateParamsStreaming> {
  const input = await toResponseInput(params.irs, params.model.modalities);
  const instructions = params.systemPrompt ? await params.systemPrompt() : undefined;

  const toolDefinitions = toResponsesTools(params.tools);
  const toolParams = toolDefinitions.length === 0 ? {} : { tools: toolDefinitions };

  const reasoningConfig = params.config?.reasoningEffort
    ? {
        reasoning: {
          effort: params.config.reasoningEffort as "low" | "medium" | "high",
          summary: "auto" as const,
        },
      }
    : {};

  return {
    model: params.model.model,
    input,
    instructions,
    ...toolParams,
    ...reasoningConfig,
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
  };
}

export function responsesCurl(request: ResponseCreateParamsStreaming, baseURL: string): string {
  return `curl -X POST '${baseURL}/responses' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer [REDACTED_API_KEY]' \\
  -d @- <<'JSON'
${JSON.stringify(request)}
JSON`;
}

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

type LoadedTool<A extends Agent<any, any, any, any>> = OwnToolRegistry<A>[keyof OwnToolRegistry<A>];

function responseInputFromIr<A extends Agent<any, any, any, any>>(
  ir: CompilerIR<A>,
  modalities?: MultimodalConfig | null,
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
    return responseToolOutput(ir.toolCall.toolCallId, ir.content, modalities);
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

function toResponsesTools<A extends Agent<any, any, any, any>>(
  tools?: Partial<OwnToolRegistry<A>>,
): FunctionTool[] {
  const toolDefs = tools || {};
  const toolEntries = Object.entries(toolDefs) as Array<[string, LoadedTool<A>]>;
  return toolEntries.map(([name, toolDef]) => {
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
}

function responseContentParts(
  content: IRContent["content"],
  modalities?: MultimodalConfig | null,
): ResponseInputContent[] {
  const output: ResponseInputContent[] = [];
  for (const part of content) {
    if (part.type === "text") {
      output.push({ type: "input_text", text: part.content });
      continue;
    }
    if (modalities?.image?.enabled) {
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
  toolCallId: string,
  content: IRContent["content"],
  modalities?: MultimodalConfig | null,
): ResponseInput {
  /*
   * The Responses API only allows plain-string function call outputs, unlike chat completions
   * and Anthropic which support image content in tool outputs. Text parts go into the output
   * string; images for vision models are delivered in a user message immediately after the
   * function call output, keeping the call/output adjacency intact without inlining base64
   * into the output string.
   */
  const textParts: string[] = [];
  const imageParts: ResponseInputContent[] = [];
  for (const part of content) {
    if (part.type === "text") {
      textParts.push(part.content);
      continue;
    }
    if (modalities?.image?.enabled) {
      imageParts.push({
        type: "input_image",
        detail: "auto",
        image_url: part.image.dataUrl,
      });
    } else {
      textParts.push(imagePlaceholderContent());
    }
  }

  const output: ResponseInput = [
    {
      type: "function_call_output",
      call_id: toolCallId,
      output: textParts.join("\n"),
    },
  ];

  if (imageParts.length > 0) {
    output.push({
      role: "user",
      content: [{ type: "input_text", text: irPrompts.toolImageOutputPreamble() }, ...imageParts],
    });
  }

  return output;
}

function imagePlaceholderContent(): string {
  return irPrompts.imageAttachmentPlaceholderText();
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
