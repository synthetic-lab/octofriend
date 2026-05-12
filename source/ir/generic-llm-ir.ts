import { t } from "structural";
import { ImageInfo } from "../utils/image-utils.ts";
import { Transport } from "../transports/transport-common.ts";
import { Result } from "../result.ts";

/*
 * LLM IR
 * -------------------------------------------------------------------------------------------------
 *
 * This defines a set of base IRs, which can be extended by callers using an Extra type.
 *
 * LLM compilers only accept the unextended base IRs. However, callers can use additional IR types
 * and convert them in a pre-compile pass to the lowered types, and tools can declare specific
 * IR extension requirements and can return those extended IRs, to help track richer information
 * that might be useful for pre-compile optimization passes.
 */

/*
 * IRs are all defined in terms of agents. Agents specify what tools they use, what subagents they
 * have, and what extended IRs they use.
 */
export type AgentDirectory = {
  [name: string]: Agent<any, any, any>;
};
export type Agent<
  Extra,
  SubagentDirectory extends AgentDirectory,
  Tools extends ToolMap<Extract<keyof SubagentDirectory, string>, Extra>,
> = {
  tools: Tools;
  agents: SubagentDirectory;
};

export function defineAgent<A extends { tools: ToolMap<any, any>; agents: AgentDirectory }>(
  a: A & ValidateAgentSubagents<A>,
): A {
  return a;
}

type CondHandlerMap<T extends AgentDirectory, Name extends keyof T> = {
  [K in Name]: (self: AgentTrajectory<T, K>) => unknown;
};
type CondHandlerReturn<C> = C[keyof C] extends (...args: any) => infer Ret ? Ret : never;
declare const mixedCondHandlerReturns: unique symbol;

// cond(...) preserves sync handlers as sync returns and async handlers as Promise returns. A plain
// conditional return type is not enough, because TypeScript can infer a mixed table as
// `string | Promise<string>`. This parameter-side validation rejects handler maps where some
// branches return PromiseLike values and others return non-Promise values.
type CondHandlerAsyncValidation<C> =
  Extract<CondHandlerReturn<C>, PromiseLike<unknown>> extends never
    ? unknown
    : Exclude<CondHandlerReturn<C>, PromiseLike<unknown>> extends never
      ? unknown
      : { readonly [mixedCondHandlerReturns]: never };

// Once mixed sync/async tables are rejected, cond(...) can return exactly what callers expect:
// sync tables return their handler value directly, async tables return one Promise for the awaited
// handler value union.
type CondReturn<C> =
  Extract<CondHandlerReturn<C>, PromiseLike<unknown>> extends never
    ? CondHandlerReturn<C>
    : Promise<Awaited<CondHandlerReturn<C>>>;

// An IR that defines sub-agent trajectories
export class AgentTrajectory<T extends AgentDirectory, Name extends keyof T> {
  readonly role = "trajectory";
  readonly ir: LlmIR<{ agents: T[Name]["agents"]; tools: T[Name]["tools"] }>[];
  private readonly name: Name;

  constructor(name: Name, ir: LlmIR<{ agents: T[Name]["agents"]; tools: T[Name]["tools"] }>[]) {
    this.name = name;
    this.ir = ir;
  }

  isNamed<N extends Name>(name: N): this is AgentTrajectory<T, N> {
    if (this.name === name) return true;
    return false;
  }

  cond<C extends CondHandlerMap<T, Name>>(
    conditions: C & CondHandlerAsyncValidation<C>,
  ): CondReturn<C> {
    for (const [k, v] of Object.entries(conditions) as Array<
      [keyof C, (self: AgentTrajectory<T, Name>) => unknown]
    >) {
      if (k === this.name) {
        return v(this) as CondReturn<C>;
      }
    }
    throw new Error("Impossible");
  }
}

export type MalformedToolRequest = {
  type: "malformed-tool-request";
  error: string;
  call: {
    original: {
      name: string;
      arguments: any;
    };
  };
  toolCallId: string;
};

export type AnthropicAssistantData = {
  thinkingBlocks: Array<
    | {
        type: "thinking";
        thinking: string;
        signature: string;
      }
    | {
        type: "redacted_thinking";
        data: string;
      }
  >;
};

export type Content = {
  content: Array<
    | {
        type: "text";
        content: string;
      }
    | {
        type: "image";
        image: ImageInfo;
      }
  >;
};

export type Checkpoint = Content & {
  role: "checkpoint";
};

export type AssistantMessage<T extends ToolMap<any, any>> = {
  role: "assistant";
  content: string;
  reasoningContent?: string | null;
  openai?: {
    encryptedReasoningContent?: string | null;
    reasoningId?: string;
  };
  anthropic?: AnthropicAssistantData;
  toolCalls?: Array<ToolCall<T> | MalformedToolRequest>;
  tokenUsage: number;
  outputTokens: number;
};

export type UserMessage = Content & {
  role: "user";
};

export type ToolOutputMessage<T extends ToolMap<any, any>> = Content & {
  role: "tool-output";
  toolCall: ToolCall<T>;
};

export type ToolRuntimeErrorMessage<T extends ToolMap<any, any>> = {
  role: "tool-runtime-error";
  toolCall: ToolCall<T>;
  error: string;
};

export type ToolValidationErrorMessage<T extends ToolMap<any, any>> = {
  role: "tool-validation-error";
  toolCall: ToolCall<T>;
  error: string;

  // TODO: remove this, if the validation is aborted treat it like an assistant message abort
  aborted: boolean;
};

export type ToolParseErrorMessage = {
  role: "tool-parse-error";
  malformedRequest: MalformedToolRequest;
};

export type ToolSkipOutputMessage<T extends ToolMap<any, any>> = {
  role: "tool-skip-output";
  toolCall: ToolCall<T>;
  reason: string;
};

export type ToolSubagentInvoke<T extends ToolMap<any, any>, SubagentName extends string> = {
  role: "tool-invoke-subagent";
  toolCall: ToolCall<T>;
  subagent: SubagentName;
};

/*
 * All base IR types except subagent trajectories.
 */
type LoweredLinearIR<T extends ToolMap<any, any>> =
  | AssistantMessage<T>
  | UserMessage
  | ToolOutputMessage<T>
  | ToolRuntimeErrorMessage<T>
  | ToolValidationErrorMessage<T>
  | ToolParseErrorMessage
  | ToolSkipOutputMessage<T>;

/*
 * All base IR types including agent trajectories, with no extension IR types.
 *
 * This is the IR intended for compiler use. Extra, extensible IRs need to be converted into lowered
 * IRs before hitting compilers.
 *
 * Forms a tree containing two node types:
 * - Linear lowered IRs, which are leaf nodes
 * - Agent Trajectories, which are non-leaf nodes containing a list of linear lowered IRs
 */
export type LoweredIR<
  AD extends AgentDirectory,
  T extends ToolMap<Extract<keyof AD, string>, any>,
> = LoweredLinearIR<T> | AgentTrajectory<AD, keyof AD>;

/*
 * All IR types including extensions.
 *
 * Allows passing in arbitrary extra IR types via the Agent's tool map. Useful for IR types
 * that not all clients might use, e.g. file IO types which may have prompt optimizations.
 */
type ToolExtra<T> = T extends ToolFactoryRequirements<any, infer Extra> ? Extra : never;
type AgentExtra<A extends Agent<any, any, any>> = ToolExtra<A["tools"][keyof A["tools"]]>;

export type LlmIR<A extends Agent<any, any, any>> =
  | AgentTrajectory<A["agents"], keyof A["agents"]>
  | LoweredLinearIR<A["tools"]>
  | AgentExtra<A>;

// A tool factory for defining tools that don't require any IR extensions
export const BASE_IR_TOOL = withIR();

/*
 * Tool definitions
 * -------------------------------------------------------------------------------------------------
 *
 * Tools have to define a few things:
 *
 * 1. A tool name.
 * 2. A schema for their input arguments from the LLM
 * 3. A schema that we parse the input into. If we don't need parse the LLM input, this can be
 *    autogenerated.
 * 4. A parse function that parses the input into the parsed form. If we don't need to parse the LLM
 *    input, this can be autogenerated.
 * 5. A validate function that validates the parsed data at runtime, e.g. "does this file still have
 *    this search string even though we performed two edits previously on it"
 * 6. A run function, which takes the tool data and runs it, returning some result
 */
export type ToolDef<
  Metadata,
  Name extends string,
  Arguments,
  Parsed,
  SubagentNames extends string,
  Extra,
> = {
  name: Name;
  ArgumentsSchema: t.Type<Arguments>;
  ParsedSchema: t.Type<Parsed>;
  parse: (
    args: ToolParseArgs<Arguments>,
  ) => Promise<Result<ParseResult<Arguments, Parsed>, string>>;
  validate: (
    abortSignal: AbortSignal,
    transport: Transport,
    t: {
      original: Schema<Name, Arguments>;
      parsed: Schema<Name, Parsed>;
    },
    cfg: Metadata,
  ) => Promise<Result<null, string>>;
  run: (
    abortSignal: AbortSignal,
    transport: Transport,
    t: {
      original: Schema<Name, Arguments>;
      parsed: Schema<Name, Parsed>;
    },
    cfg: Metadata,
  ) => Promise<Result<ToolReturn<SubagentNames, Extra>, string>>;
};

export type ToolParseArgs<Arguments> = {
  signal: AbortSignal;
  transport: Transport;
  original: Arguments;
};

export type ParseResult<Arguments, Parsed> = {
  original: Arguments;
  parsed: Parsed;
};

/*
 * Basic schema for tool calling
 */
type Schema<Name extends string, Arguments> = {
  name: Name;
  arguments: Arguments;
};

/*
 * Tools can return:
 *
 * - output content
 * - subagent invocations (for their subagent dependencies)
 * - any custom LLM IR defined
 */
export type ToolReturn<SubagentName extends string, Extra> =
  | (Content & {
      type: "output";

      // The line count to show in the UI, if it's not just the number of lines in the content
      lines?: number;
    })
  | {
      type: "invoke-subagent";
      name: SubagentName;
    }
  | {
      type: "custom-ir";
      data: Extra;
    };

type RawToolFactory<
  Config,
  S extends Schema<any, any>,
  Parsed,
  SubagentNames extends string,
  Extra,
> = (args: {
  signal: AbortSignal;
  transport: Transport;
  config: Config;
}) => Promise<ToolDef<Config, S["name"], S["arguments"], Parsed, SubagentNames, Extra> | null>;

type SimpleRawToolFactory<
  Config,
  S extends Schema<any, any>,
  Parsed,
  SubagentNames extends string,
  Extra,
> = (args: {
  signal: AbortSignal;
  transport: Transport;
  config: Config;
}) => Promise<
  | (Omit<
      ToolDef<Config, S["name"], S["arguments"], Parsed, SubagentNames, Extra>,
      "ArgumentsSchema" | "ParsedSchema" | "name" | "validate"
    > &
      Partial<
        Pick<ToolDef<Config, S["name"], S["arguments"], Parsed, SubagentNames, Extra>, "validate">
      >)
  | null
>;

type SimpleAutoParsedRawToolFactory<
  Config,
  S extends Schema<any, any>,
  SubagentNames extends string,
  Extra,
> = (args: {
  signal: AbortSignal;
  transport: Transport;
  config: Config;
}) => Promise<
  | (Omit<
      ToolDef<Config, S["name"], S["arguments"], S["arguments"], SubagentNames, Extra>,
      "ArgumentsSchema" | "ParsedSchema" | "name" | "parse" | "validate"
    > &
      Partial<
        Pick<
          ToolDef<Config, S["name"], S["arguments"], S["arguments"], SubagentNames, Extra>,
          "validate"
        >
      >)
  | null
>;

type ToolFactoryConfig<T> = T extends (args: {
  signal: AbortSignal;
  transport: Transport;
  config: infer Config;
}) => any
  ? Config
  : never;

type ToolFactoryArgs<Config> = {
  signal: AbortSignal;
  transport: Transport;
  config: Config;
};

type DynamicToolFactoryReturn<T extends (...args: any) => any> = ReturnType<
  Extract<Exclude<Awaited<ReturnType<T>>, null>, (...args: any) => any>
>;

type DynamicToolFactoryArgs<T extends (...args: any) => any> =
  Parameters<T> extends [infer Args]
    ? Args
    : ToolFactoryArgs<ToolFactoryConfig<Exclude<Awaited<ReturnType<T>>, null>>>;

type DynamicToolFactorySubagents<T extends (...args: any) => any> = ToolSubagentNames<
  Exclude<Awaited<ReturnType<T>>, null>
>;

type RuntimeToolDefinition<Extra> = Omit<
  ToolDef<unknown, string, unknown, unknown, string, Extra>,
  "ArgumentsSchema" | "ParsedSchema" | "name" | "parse" | "validate"
> &
  Partial<Pick<ToolDef<unknown, string, unknown, unknown, string, Extra>, "parse" | "validate">>;

// Public tool factories are the precise raw factory type plus the capability brand. Keeping the raw
// factory in the intersection preserves literal tool names and parsed argument types.
export type ToolFactory<
  Config,
  S extends Schema<any, any>,
  Parsed,
  SubagentNames extends string,
  Extra,
> = RawToolFactory<Config, S, Parsed, SubagentNames, Extra> &
  ToolFactoryRequirements<SubagentNames, Extra>;

export function withIR<Extra = never>() {
  /*
   * Caller-facing static tool builder, explicit parse form.
   *
   * Use this when the LLM's raw arguments are not the shape the tool wants to run with. The caller
   * supplies both schemas up front, then define(...) must supply parse({ original, ... }) to produce ParsedSchema.
   * Example: read({ path }) parses into { path, originalFileContents }.
   *
   * The return type is intentionally precise: the resulting tool remembers its name, raw args,
   * parsed args, subagent dependencies, and this withIR(...) instance's Extra IR type.
   */
  function declare<
    Name extends string,
    Arguments,
    Parsed,
    const SubagentNames extends string = never,
  >(partial: {
    name: Name;
    ArgumentsSchema: t.Type<Arguments>;
    ParsedSchema: t.Type<Parsed>;
    subagents?: readonly SubagentNames[];
  }): {
    define: <
      T extends SimpleRawToolFactory<any, Schema<Name, Arguments>, Parsed, SubagentNames, Extra>,
    >(
      factory: (args: Parameters<T>[0]) => Promise<Awaited<ReturnType<T>>>,
    ) => RawToolFactory<
      ToolFactoryConfig<T>,
      Schema<Name, Arguments>,
      Parsed,
      SubagentNames,
      Extra
    > &
      ToolFactoryRequirements<SubagentNames, Extra>;
  };

  /*
   * Caller-facing static tool builder, auto-parse form.
   *
   * Use this for the common case where the LLM's raw arguments are already the shape the tool runs
   * with. The caller omits ParsedSchema and parse(...). The resulting tool behaves as if
   * ParsedSchema === ArgumentsSchema and parse(...) returned { original: x, parsed: x }.
   *
   * Subagent inference still works here: subagents: ["view"] records "view"; omitting subagents
   * records never.
   */
  function declare<
    Name extends string,
    Arguments,
    const SubagentNames extends string = never,
  >(partial: {
    name: Name;
    ArgumentsSchema: t.Type<Arguments>;
    ParsedSchema?: undefined;
    subagents?: readonly SubagentNames[];
  }): {
    define: <
      T extends SimpleAutoParsedRawToolFactory<any, Schema<Name, Arguments>, SubagentNames, Extra>,
    >(
      factory: (args: Parameters<T>[0]) => Promise<Awaited<ReturnType<T>>>,
    ) => RawToolFactory<
      ToolFactoryConfig<T>,
      Schema<Name, Arguments>,
      Arguments,
      SubagentNames,
      Extra
    > &
      ToolFactoryRequirements<SubagentNames, Extra>;
  };

  /*
   * Implementation shared by both static builder forms.
   *
   * From the caller's perspective, declare(...).define(...) returns a load-time factory. At runtime we
   * call the caller's factory, then attach the metadata owned by declare(...): the public name, the raw
   * schema, the parsed schema, and the generated parser when no custom parser was supplied.
   *
   * The overload signatures above provide the precise API. This body deliberately works with a
   * looser runtime shape, then casts once at the boundary to attach the compile-time-only brand.
   */
  function declare(partial: {
    name: string;
    ArgumentsSchema: t.Type<unknown>;
    ParsedSchema?: t.Type<unknown>;
    subagents?: readonly string[];
  }) {
    return {
      define: (
        factory: (args: ToolFactoryArgs<unknown>) => Promise<RuntimeToolDefinition<Extra> | null>,
      ) => {
        const wrapped = async (args: ToolFactoryArgs<unknown>) => {
          const def = await factory(args);
          if (def === null) return null;

          return {
            ...def,
            name: partial.name,
            ArgumentsSchema: partial.ArgumentsSchema,
            ParsedSchema: partial.ParsedSchema ?? partial.ArgumentsSchema,
            parse:
              def.parse ??
              (async ({ original }) => ({
                success: true as const,
                data: {
                  original,
                  parsed: original,
                },
              })),
            validate: def.validate ?? (async () => ({ success: true, data: null })),
          };
        };

        // The brand has no runtime representation; it only makes defineIR reject tools whose custom
        // IR output is not included in the target IR universe.
        return wrapped as unknown as ToolFactory<
          unknown,
          Schema<string, unknown>,
          unknown,
          string,
          Extra
        >;
      },
    };
  }

  return {
    /*
     * Caller-facing dynamic tool builder.
     *
     * Use this when the exact tool shape is not known until load time, for example when the schema
     * depends on config, transport capabilities, or discovered project state. The caller returns a
     * normal declare(...).define(...) result from the selector rather than repeating a second dynamic
     * API for name/schema/subagents/parse behavior.
     *
     * The selected tool carries the same type information as a static tool. This wrapper preserves
     * that information and forwards the runtime args into the selected factory.
     */
    dynamicDefineTool: <
      T extends (
        args: ToolFactoryArgs<any>,
      ) => Promise<ToolFactory<any, any, any, any, Extra> | null>,
    >(
      factory: T,
    ): ((args: DynamicToolFactoryArgs<T>) => DynamicToolFactoryReturn<T>) &
      ToolFactoryRequirements<DynamicToolFactorySubagents<T>, Extra> => {
      const selectTool = factory as unknown as (args: DynamicToolFactoryArgs<T>) => ReturnType<T>;

      const wrapped = async (args: DynamicToolFactoryArgs<T>) => {
        const selectedTool = await selectTool(args);
        const runSelectedTool = selectedTool as
          | null
          | ((args: DynamicToolFactoryArgs<T>) => DynamicToolFactoryReturn<T>);

        // One-level flatMap: the selector returns a tool factory; dynamicDefineTool must itself
        // behave like a tool factory that returns the selected tool definition.
        return runSelectedTool?.(args) ?? null;
      };

      // The brand has no runtime representation; it only makes defineIR reject tools whose custom
      // IR output is not included in the target IR universe.
      return wrapped as unknown as ((
        args: DynamicToolFactoryArgs<T>,
      ) => DynamicToolFactoryReturn<T>) &
        ToolFactoryRequirements<DynamicToolFactorySubagents<T>, Extra>;
    },
    declare,
  };
}

export type ToolMap<SubagentNames extends string, Extra> = {
  [key: string]: ToolFactory<any, any, any, SubagentNames, Extra>;
};
export type LoadedTools<T extends ToolMap<any, any>> = {
  [K in keyof T]: Exclude<Awaited<ReturnType<T[K]>>, null>;
};
export type ToolCall<T extends ToolMap<any, any>> = {
  [K in keyof LoadedTools<T>]: {
    type: "tool-call";
    name: LoadedTools<T>[K]["name"];
    toolCallId: string;
    parsed: t.GetType<LoadedTools<T>[K]["ParsedSchema"]>;
    original: t.GetType<LoadedTools<T>[K]["ArgumentsSchema"]>;
  };
}[keyof LoadedTools<T>];

/*
 * ALERT ALERT
 *
 * Type system bullshit used for branding and validating IRs with respect to tools and subagent
 * dependencies.
 */

// Tool factories are structurally just functions, so TypeScript can otherwise forget which IR
// extension set they were created for if the implementation does not currently return custom IR.
// These unique-symbol fields are a compile-time-only brand attached by defineTool.
declare const toolFactoryExtra: unique symbol;
declare const toolFactorySubagents: unique symbol;
declare const missingToolSubagents: unique symbol;

// The brand should be covariant: a base tool that emits no custom IR (never) is valid in a richer
// IR context, but a richer tool is not valid in a base IR context.
type Covariant<T> = () => T;

// Required phantom fields keep Extra and SubagentNames visible when checking assignability to a
// ToolMap. They are never read or written at runtime.
type ToolFactoryRequirements<SubagentNames extends string, Extra> = {
  readonly [toolFactoryExtra]: Covariant<Extra>;
  readonly [toolFactorySubagents]: Covariant<SubagentNames>;
};

type ToolSubagentNames<T> =
  T extends ToolFactoryRequirements<infer SubagentNames, any> ? SubagentNames : never;
type RequiredToolSubagentNames<Tools> = ToolSubagentNames<Tools[keyof Tools]>;

// Type used to validate that the given agent's tools have all of their subagent dependencies
// fulfilled.
type ValidateAgentSubagents<A> = A extends { tools: infer Tools; agents: infer SubagentDirectory }
  ? Exclude<
      RequiredToolSubagentNames<Tools>,
      Extract<keyof SubagentDirectory, string>
    > extends never
    ? {
        agents: { [K in keyof SubagentDirectory]: ValidateAgentSubagents<SubagentDirectory[K]> };
      }
    : {
        readonly [missingToolSubagents]: Exclude<
          RequiredToolSubagentNames<Tools>,
          Extract<keyof SubagentDirectory, string>
        >;
      }
  : never;
