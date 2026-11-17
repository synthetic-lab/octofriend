import type Anthropic from "@anthropic-ai/sdk";
import { toJSONSchema } from "structural";
import type { CompileInputs, CompilerIR } from "../protocol-interface.ts";
import type { Agent, Content as IRContent, OwnToolRegistry } from "../../llm-ir.ts";
import * as irPrompts from "../ir-prompts.ts";
import type { MultimodalConfig } from "../../modalities.ts";

/*
 * Everything the compiler needs to build a Claude Messages request body. The shipped protocol
 * extends this with a client; compile-only callers (e.g. hosts that enqueue requests) supply just
 * these knobs.
 */
export type AnthropicCompileConfig = {
  maxTokens: number;
  thinking?: Anthropic.ThinkingConfigParam;
  outputConfig?: Anthropic.OutputConfig;
};

/*
 * Compiles libocto IR into a complete Claude Messages request body. `tool_choice` and `stream`
 * are set here rather than by callers, since every successful request needs them.
 */
export async function anthropicCompiler<A extends Agent<any, any, any, any>>(
  params: CompileInputs<A> & { config: AnthropicCompileConfig },
): Promise<Anthropic.MessageCreateParamsStreaming> {
  const messages = toModelMessage(params.irs, params.model.modalities);
  const system = params.systemPrompt ? await params.systemPrompt() : "";

  const toolDefinitions = toAnthropicTools(params.tools);
  const toolParams = toolDefinitions.length === 0 ? {} : { tools: toolDefinitions };

  const { config } = params;
  return {
    system,
    model: params.model.model,
    messages,
    ...toolParams,
    tool_choice: {
      type: "auto",
      disable_parallel_tool_use: false,
    },
    max_tokens: config.maxTokens,
    ...(config.thinking ? { thinking: config.thinking } : {}),
    ...(config.outputConfig ? { output_config: config.outputConfig } : {}),
    stream: true,
  };
}

export function anthropicCurl(
  request: Anthropic.MessageCreateParamsStreaming,
  baseURL: string,
): string {
  // Curl requests need an API Version
  // Currently hardcoded in Anthropic SDK
  const ANTHROPIC_API_VERSION = "2023-06-01";

  return `curl -X POST "${baseURL}/v1/messages" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: [REDACTED_API_KEY]" \\
  -H "anthropic-version: ${ANTHROPIC_API_VERSION}" \\
  -d @- <<'JSON'
${JSON.stringify(request)}
JSON`;
}

type LoadedTool<A extends Agent<any, any, any, any>> = OwnToolRegistry<A>[keyof OwnToolRegistry<A>];

function toModelMessage<A extends Agent<any, any, any, any>>(
  messages: Array<CompilerIR<A>>,
  modalities?: MultimodalConfig | null,
): Array<Anthropic.MessageParam> {
  const output: Anthropic.MessageParam[] = [];

  for (const ir of messages) {
    output.push(modelMessageFromIr(ir, modalities));
  }

  return output;
}

function modelMessageFromIr<A extends Agent<any, any, any, any>>(
  ir: CompilerIR<A>,
  modalities?: MultimodalConfig | null,
): Anthropic.MessageParam {
  if (ir.role === "assistant") {
    const thinkingBlocks = ir.anthropic?.thinkingBlocks || [];
    const toolCalls = ir.toolCalls || [];
    return {
      role: "assistant",
      content: [
        ...thinkingBlocks,
        { type: "text", text: ir.content || " " },
        ...toolCalls
          .filter((t: any) => t.type === "tool-call")
          .map((t: any) => {
            return {
              type: "tool_use" as const,
              id: t.toolCallId,
              name: t.name,
              input: t.original || {},
            };
          }),
      ],
    };
  }

  if (ir.role === "user") {
    return {
      role: "user",
      content: anthropicContentParts(ir.content, modalities),
    };
  }

  if (ir.role === "tool-output") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          content: anthropicContentParts(ir.content, modalities),
        },
      ],
    };
  }

  if (ir.role === "tool-skip-output") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          is_error: true,
          content: irPrompts.toolSkip(ir.reason),
        },
      ],
    };
  }

  if (ir.role === "tool-runtime-error") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          is_error: true,
          content: `Error: ${ir.error}`,
        },
      ],
    };
  }

  if (ir.role === "tool-parse-error") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.malformedRequest.toolCallId,
          is_error: true,
          content: `Error: ${ir.malformedRequest.error}`,
        },
      ],
    };
  }

  if (ir.role === "tool-validation-error") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: ir.toolCall.toolCallId,
          is_error: true,
          content: `Error: ${ir.error}`,
        },
      ],
    };
  }

  if (ir.role === "lowered-checkpoint") {
    return {
      role: "user",
      content: anthropicContentParts(ir.content, modalities),
    };
  }

  const _: never = ir;
  throw new Error(`Unsupported IR role: ${(ir as any).role}`);
}

function toAnthropicTools<A extends Agent<any, any, any, any>>(
  tools?: Partial<OwnToolRegistry<A>>,
) {
  const toolDefs = tools || {};
  const toolDefinitions: Array<{ description: string; input_schema: any; name: string }> = [];
  const toolEntries = Object.entries(toolDefs) as Array<[string, LoadedTool<A>]>;
  for (const [name, toolDef] of toolEntries) {
    const argJsonSchema = toJSONSchema("ignore", toolDef.ArgumentsSchema);
    // Delete JSON schema fields unused by Anthropic; some backends will error if present
    // @ts-ignore
    delete argJsonSchema.$schema;
    delete argJsonSchema.description;
    // @ts-ignore
    delete argJsonSchema.title;

    toolDefinitions.push({
      name,
      description: toolDef.description,
      input_schema: argJsonSchema,
    });
  }
  return toolDefinitions;
}

function anthropicContentParts(
  content: IRContent["content"],
  modalities?: MultimodalConfig | null,
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  const output: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  for (const part of content) {
    if (part.type === "text") {
      output.push({ type: "text", text: part.content });
      continue;
    }
    if (modalities?.image?.enabled) {
      output.push({
        type: "image",
        source: {
          type: "base64",
          media_type: part.image.mimeType,
          data: part.image.base64Data,
        },
      });
    } else {
      output.push({ type: "text", text: imagePlaceholderContent() });
    }
  }
  return output;
}

function imagePlaceholderContent(): string {
  return irPrompts.imageAttachmentPlaceholderText();
}
