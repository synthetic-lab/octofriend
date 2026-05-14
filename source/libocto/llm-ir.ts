import { ImageInfo } from "../utils/image-utils.ts";
import type { ToolCall, ToolFactoryRequirements, ToolMap, ToolSubagentNames } from "./tool-def.ts";

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
export type Agent<
  Extra,
  SubagentDirectory extends AgentDirectory,
  Tools extends ToolMap<Extract<keyof SubagentDirectory, string>, Extra>,
> = {
  tools: Tools;
  agents: SubagentDirectory;
};

// A named directory of agents
export type AgentDirectory = {
  [name: string]: Agent<any, any, any>;
};

// Helper function to define agents with compile-time safety guarantees. It's an identity function
// that runs compile-time validation on the passed-in agent and assigns the correct type + branding.
export function defineAgent<A extends { tools: ToolMap<any, any>; agents: AgentDirectory }>(
  a: A & ValidateAgentSubagents<A>,
): A {
  return a;
}

// An IR that defines sub-agent trajectories
export class AgentTrajectory<T extends AgentDirectory, Name extends keyof T> {
  readonly role = "trajectory";
  readonly ir: LlmIR<{ agents: T[Name]["agents"]; tools: T[Name]["tools"] }>[];
  private readonly name: Name;

  constructor(name: Name, ir: LlmIR<{ agents: T[Name]["agents"]; tools: T[Name]["tools"] }>[]) {
    this.name = name;
    this.ir = ir;
  }

  // A type guard to check whether an AgentTrajectory belongs to a specific named subagent. This is
  // useful since different subagents may have different tools, so you can narrow which tools an
  // if-statement needs to check for by first checking which subagent you're dealing with.
  // For example:
  //
  // if(agentIr.isNamed("research")) {
  //   // Only tools and subagents that the research subagent has access to are accessible here
  // }
  isNamed<N extends Name>(name: N): this is AgentTrajectory<T, N> {
    if (this.name === name) return true;
    return false;
  }

  // A helpful function for checking *all* possible subagent names, and narrowing each one down in a
  // callback. For example, if you had "explore" and "research" subagents, you might call:
  //
  // ir.cond({
  //   explore: exploreIr => {
  //     // exploreIr is guaranteed to be an explore subagent trajectory
  //     // any tools and subagents are narrowed to only what's accessible to the explore subagent
  //   },
  //   research: researchIr => {
  //     // researchIr is guaranteed to be a research subagent trajectory
  //     // any tools and subagents are narrowed to only what's accessible to the research subagent
  //   },
  // });
  //
  // Like Lisp-like `cond` expressions, `cond` returns whatever the cond arms return. It can take
  // either synchronous handlers, or async handlers. If it takes sync handlers, it returns a
  // non-promise; if it takes async handlers, it returns a promise that you can await.
  //
  // For example:
  //
  // const output = await ir.cond({
  //   explore: async (exploreIr) => {
  //     return someOutput;
  //   },
  //   research: async (researchIr) => {
  //     return someOtherOutput;
  //   },
  // });
  //
  // Note that the handlers must be all-async, or all-sync; you can't mix sync and async.
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

/*
 * Agent dependency compile-time validation/branding
 * -------------------------------------------------------------------------------------------------
 *
 * Checks that for a given agent with subagents, all tools that declare subagent dependencies have
 * those dependencies satisfied. For example, if a `research` tool expects to be able to invoke a
 * `research` subagent, and you use the research tool but don't define a research subagent, you'll
 * get a compile error.
 */
declare const missingToolSubagents: unique symbol;

type RequiredToolSubagentNames<Tools> = ToolSubagentNames<Tools[keyof Tools]>;

// Type used to validate that the given agent's tools have all of their subagent dependencies
// fulfilled. Recursively narrows the given type until it's either {} (all dependencies are
// satisfied), or an impossible-to-construct type via the non-existent missingToolSubagents unique
// symbol, which will cause a useful compile error.
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
