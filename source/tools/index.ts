import toolMap from "./tool-defs/index.ts";
import { Config, ModelConfig } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { Result, ok, err } from "../libocto/result.ts";
import { estimateTokens } from "../ir/count-ir-tokens.ts";
import {
  LoadedTools as GenericLoadedTools,
  ToolCall as GenericToolCall,
  ToolFactoryRequirements,
  ToolReturn,
} from "../libocto/tool-def.ts";

export type LoadedTools = GenericLoadedTools<typeof toolMap>;
export type ToolCall = GenericToolCall<typeof toolMap>;
type ToolExtra<T> = T extends ToolFactoryRequirements<any, infer Extra> ? Extra : never;
export type ToolRunResult = ToolReturn<never, ToolExtra<(typeof toolMap)[keyof typeof toolMap]>>;

export async function loadTools(
  transport: Transport,
  signal: AbortSignal,
  config: Config,
): Promise<Partial<LoadedTools>> {
  const loaded: Partial<LoadedTools> = {};

  await Promise.all(
    (Object.keys(toolMap) as Array<keyof typeof toolMap>).map(async key => {
      const toolDef = await toolMap[key]({ signal, transport, data: config });
      if (toolDef) {
        toolDef.name = key;
        // @ts-ignore
        loaded[key] = toolDef;
      }
    }),
  );

  return loaded as LoadedTools;
}

export const SKIP_CONFIRMATION_TOOLS: Array<keyof LoadedTools> = [
  "read",
  "partial-read",
  "list",
  "skill",
  "web-search",
  "fetch",
  "glob",
  "grep",
  "lsp-definition",
  "lsp-references",
  "lsp-hover",
  "lsp-diagnostics",
  "lsp-document-symbol",
  "lsp-implementation",
  "lsp-incoming-calls",
  "lsp-outgoing-calls",
];

export const ALWAYS_REQUEST_PERMISSION_TOOLS: Array<keyof LoadedTools> = [
  "shell",
  "background-process",
];

// Cap tool outputs so one huge result can't push history past the context limit and break autocompaction
export const MAX_TOOL_OUTPUT_CONTEXT_FRACTION = 0.2;

export async function runTool(
  abortSignal: AbortSignal,
  transport: Transport,
  loaded: Partial<LoadedTools>,
  call: ToolCall,
  config: Config,
  model: ModelConfig,
): Promise<Result<ToolRunResult, string>> {
  const def = lookup(loaded, call);
  if (!def.success) return def;
  const output = await (def.data as any).run({
    signal: abortSignal,
    transport,
    toolCall: {
      toolCallId: call.toolCallId,
      original: { name: call.name, arguments: call.original },
      parsed: { name: call.name, arguments: call.parsed },
    },
    data: config,
  });
  if (!output.success) return output;

  const maxTokens = Math.floor(model.context * MAX_TOOL_OUTPUT_CONTEXT_FRACTION);
  const tokens = toolOutputTokens(output.data);
  if (tokens >= maxTokens) {
    const preview = outputPreview(output.data, PREVIEW_CHARS);
    return err(
      `Tool output was too large: approximately ${tokens} tokens, which is ` +
        `${MAX_TOOL_OUTPUT_CONTEXT_FRACTION * 100}% or more of the model's ` +
        `${model.context}-token context window. The output was discarded to protect the ` +
        `context window. Retry with a more targeted approach: page through the file with ` +
        `partial-read using offset/limit, narrow searches with tighter patterns or ` +
        `maxResults, or limit shell output (e.g. pipe through head/tail/grep). Before it ` +
        `was discarded, the first ${PREVIEW_CHARS} characters were preserved so you can ` +
        `inspect them; here they are:\n${preview}`,
    );
  }
  return output;
}

const PREVIEW_CHARS = 200;

function outputPreview(result: ToolRunResult, maxChars: number): string {
  let text = "";
  if (result.type === "output") {
    for (const part of result.content) {
      if (part.type !== "text") continue;
      text += part.content.slice(0, maxChars - text.length);
      if (text.length >= maxChars) break;
    }
  } else if (result.type === "custom-ir") {
    text = result.data.content.slice(0, maxChars);
  }
  return text;
}

function toolOutputTokens(result: ToolRunResult): number {
  if (result.type === "output") {
    let tokens = 0;
    for (const part of result.content) {
      if (part.type === "text") tokens += estimateTokens(part.content);
    }
    return tokens;
  }
  if (result.type === "custom-ir") {
    return estimateTokens(result.data.content);
  }
  return 0;
}

export async function validateTool(
  abortSignal: AbortSignal,
  transport: Transport,
  loaded: Partial<LoadedTools>,
  tool: ToolCall,
  config: Config,
): Promise<Result<null, string>> {
  const toolDef = lookup(loaded, tool);
  if (!toolDef.success) return toolDef;
  return await toolDef.data.validate(
    abortSignal,
    transport,
    {
      original: { name: tool.name, arguments: tool.original },
      parsed: { name: tool.name, arguments: tool.parsed },
    },
    config,
  );
}

function lookup<T extends ToolCall>(loaded: Partial<LoadedTools>, t: T): Result<any, string> {
  const def = (loaded as any)[(t as any).name];
  if (def == null) return err(`No tool named ${t.name}`);
  return ok(def);
}
